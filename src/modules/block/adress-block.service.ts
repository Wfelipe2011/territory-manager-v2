import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PrismaTransaction } from 'src/infra/prisma';
import { ThemeMode } from '@prisma/client';
import { themeColors } from 'src/constants/themeColors';

const TTL_SYNC_GHOST = 86_400_000; // 24 horas

interface AddressDto {
    id?: number;
    street: string;
    zipCode?: string;
}

@Injectable()
export class AddressBlockService {
    private readonly logger = new Logger(AddressBlockService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    ) { }

    async manageAddresses(territoryBlockId: number, addresses: AddressDto[] = [], tenantId: number, prisma: PrismaTransaction = this.prisma) {
        this.logger.log('Gerenciando endereços associados');

        const territoryBlock = await prisma.territory_block.findUnique({ where: { id: territoryBlockId, tenantId } });
        if (!territoryBlock) {
            this.logger.error(`Bloco de território não encontrado com ID: ${territoryBlockId}`);
            return;
        }
        this.logger.log(`Territory Block encontrado: ${JSON.stringify(territoryBlock)}`);

        const existingTerritoryBlockAddresses = await prisma.territory_block_address.findMany({
            where: { territoryBlockId, tenantId },
            include: { address: true },
        });

        // Se não há endereços, remove tudo (endereços, casas e rounds)
        if (!addresses.length) {
            this.logger.log('Nenhum endereço fornecido. Removendo todas as associações.');

            const existingAddressIds = existingTerritoryBlockAddresses.map((a) => a.id);

            await this.deleteHousesAndRounds(existingAddressIds, territoryBlock, tenantId, prisma);
            await prisma.territory_block_address.deleteMany({ where: { territoryBlockId, tenantId } });
            this.logger.log('Todas as associações foram removidas.');
            return;
        }

        const existingAddressById = new Map(existingTerritoryBlockAddresses.map((tba) => [tba.addressId, tba]));
        const renameInputs = addresses.filter((address) => {
            if (!address.id) return false;
            const linkedAddress = existingAddressById.get(address.id);
            if (!linkedAddress) return false;
            return this.normalizeStreet(linkedAddress.address.name) !== this.normalizeStreet(address.street);
        });

        const renamedAddressIds = new Set<number>();
        for (const address of renameInputs) {
            const linkedAddress = existingAddressById.get(address.id!);
            if (!linkedAddress) continue;

            const migratedAddressId = await this.migrateAddressInPlace(
                linkedAddress.id,
                linkedAddress.addressId,
                address.street,
                territoryBlock,
                tenantId,
                prisma
            );

            renamedAddressIds.add(migratedAddressId);
        }

        if (renameInputs.length) {
            await this.cacheManager.del(`addresses:${territoryBlock.territoryId}:${territoryBlock.blockId}`);
            await this.invalidateSyncGhostCache(tenantId, territoryBlock.territoryId, territoryBlock.blockId);
        }

        const addressesWithoutRename = addresses.filter((address) => !renameInputs.includes(address));

        // Upsert de endereços
        const upsertedAddresses = await this.upsertAddress(addressesWithoutRename, tenantId, prisma);

        const desiredAddressIds = new Set<number>([
            ...upsertedAddresses.map((a) => a.id),
            ...Array.from(renamedAddressIds),
        ]);

        // Busca endereços existentes associados ao bloco
        const currentTerritoryBlockAddresses = await prisma.territory_block_address.findMany({
            where: { territoryBlockId, tenantId },
        });
        this.logger.log(`Endereços existentes: ${JSON.stringify(currentTerritoryBlockAddresses)}`);

        const existingAddressIds = currentTerritoryBlockAddresses.map((a) => a.addressId);

        // Deleta endereços que não estão mais na lista
        const addressesToDelete = existingAddressIds.filter((id) => !desiredAddressIds.has(id));
        if (addressesToDelete.length) {
            this.logger.log(`Removendo os endereços: ${addressesToDelete}`);
            const territoryBlockAddressIds = currentTerritoryBlockAddresses
                .filter((tba) => addressesToDelete.includes(tba.addressId))
                .map((tba) => tba.id);

            await this.deleteHousesAndRounds(territoryBlockAddressIds, territoryBlock, tenantId, prisma);
            await prisma.territory_block_address.deleteMany({
                where: { id: { in: territoryBlockAddressIds }, tenantId },
            });
            this.logger.log(`Endereços removidos: ${addressesToDelete}`);
        }

        const remainingTerritoryBlockAddresses = await prisma.territory_block_address.findMany({
            where: { territoryBlockId, tenantId },
        });
        const remainingAddressIds = new Set(remainingTerritoryBlockAddresses.map((a) => a.addressId));

        // Adiciona novos endereços e cria casas fantasmas
        const newAddresses = Array.from(desiredAddressIds).filter((id) => !remainingAddressIds.has(id));
        for (const addressId of newAddresses) {
            const territoryBlockAddress = await prisma.territory_block_address.create({
                data: { addressId, territoryBlockId, tenantId },
            });
            this.logger.log(`Adicionado endereço com ID: ${addressId}`);

            await prisma.house.updateMany({
                where: {
                    addressId,
                    blockId: territoryBlock.blockId,
                    territoryId: territoryBlock.territoryId,
                    tenantId,
                    territoryBlockAddressId: null,
                },
                data: {
                    territoryBlockAddressId: territoryBlockAddress.id,
                },
            });

            // Criação de casa fantasma, se necessário
            const house = await prisma.house.findFirst({
                where: {
                    addressId,
                    blockId: territoryBlock.blockId,
                    tenantId,
                    territoryId: territoryBlock.territoryId,
                    territoryBlockAddressId: territoryBlockAddress.id,
                }
            });

            if (!house) {
                await this.createGhostHouse(addressId, territoryBlock, territoryBlockAddress.id, tenantId, prisma);
            }
        }
    }

    private async upsertAddress(addresses: AddressDto[], tenantId: number, prisma: PrismaTransaction) {
        this.logger.log(`Iniciando upsert de endereços: ${JSON.stringify(addresses)}`);
        const upsertedAddresses = await Promise.all(
            addresses.map(async (address) => {
                const street = address.street.trim();
                this.logger.log(`Buscando endereço exato case-insensitive para: ${street}`);
                const existingAddress = await prisma.address.findFirst({
                    where: {
                        name: {
                            equals: street,
                            mode: 'insensitive',
                        },
                        tenantId,
                    },
                });

                if (existingAddress) {
                    this.logger.debug(`Endereço exato encontrado, reutilizando: ${JSON.stringify(existingAddress)}`);
                    return existingAddress;
                }

                this.logger.log(`Criando novo endereço para: ${street}`);
                const newAddress = await prisma.address.create({
                    data: { name: street, zipCode: address.zipCode, tenantId },
                });
                this.logger.log(`Novo endereço criado: ${JSON.stringify(newAddress)}`);
                return newAddress;
            })
        );

        const resolvedAddresses = upsertedAddresses.filter((a) => {
            if (!a) this.logger.warn('Endereço não encontrado, ignorando.');
            return a !== null;
        }) as NonNullable<(typeof upsertedAddresses)[number]>[];

        this.logger.log(`Endereços processados: ${JSON.stringify(resolvedAddresses)}`);
        return resolvedAddresses;
    }

    private normalizeStreet(street: string) {
        return street.trim().toLocaleLowerCase();
    }

    private async migrateAddressInPlace(
        territoryBlockAddressId: number,
        oldAddressId: number,
        newStreet: string,
        territoryBlock: { id: number; blockId: number; territoryId: number },
        tenantId: number,
        prisma: PrismaTransaction
    ): Promise<number> {
        const [newAddress] = await this.upsertAddress([{ street: newStreet }], tenantId, prisma);

        if (!newAddress || newAddress.id === oldAddressId) {
            return oldAddressId;
        }

        const existingTargetTba = await prisma.territory_block_address.findFirst({
            where: {
                territoryBlockId: territoryBlock.id,
                tenantId,
                addressId: newAddress.id,
            },
            select: { id: true },
        });

        const targetTerritoryBlockAddressId = existingTargetTba?.id ?? territoryBlockAddressId;

        if (!existingTargetTba) {
            await prisma.territory_block_address.update({
                where: { id: territoryBlockAddressId, tenantId },
                data: { addressId: newAddress.id },
            });
        }

        await prisma.house.updateMany({
            where: {
                tenantId,
                blockId: territoryBlock.blockId,
                territoryId: territoryBlock.territoryId,
                territoryBlockAddressId,
            },
            data: {
                addressId: newAddress.id,
                territoryBlockAddressId: targetTerritoryBlockAddressId,
            },
        });

        await prisma.house.updateMany({
            where: {
                tenantId,
                blockId: territoryBlock.blockId,
                territoryId: territoryBlock.territoryId,
                addressId: oldAddressId,
                territoryBlockAddressId: null,
            },
            data: {
                addressId: newAddress.id,
                territoryBlockAddressId: targetTerritoryBlockAddressId,
            },
        });

        if (existingTargetTba && existingTargetTba.id !== territoryBlockAddressId) {
            await prisma.territory_block_address.delete({
                where: { id: territoryBlockAddressId, tenantId },
            });
        }

        return newAddress.id;
    }

    // Método para deletar casas e rounds associados
    private async deleteHousesAndRounds(
        territoryBlockAddressIds: number[],
        territoryBlock: { id: number; blockId: number; territoryId: number },
        tenantId: number,
        prisma: PrismaTransaction
    ) {
        this.logger.log(`Iniciando remoção de casas e rounds associados aos endereços: ${territoryBlockAddressIds}`);

        if (!territoryBlockAddressIds.length) {
            return;
        }

        const linkedAddresses = await prisma.territory_block_address.findMany({
            where: {
                id: { in: territoryBlockAddressIds },
                territoryBlockId: territoryBlock.id,
                tenantId,
            },
            select: {
                addressId: true,
            },
        });

        const addressIds = linkedAddresses.map((tba) => tba.addressId);

        // Busca casas associadas aos endereços
        const houses = await prisma.house.findMany({
            where: {
                blockId: territoryBlock.blockId,
                territoryId: territoryBlock.territoryId,
                tenantId,
                OR: addressIds.length
                    ? [
                        { territoryBlockAddressId: { in: territoryBlockAddressIds } },
                        { territoryBlockAddressId: null, addressId: { in: addressIds } },
                    ]
                    : [{ territoryBlockAddressId: { in: territoryBlockAddressIds } }],
            },
            select: { id: true },
        });
        const houseIds = houses.map((h) => h.id);

        if (houseIds.length) {
            // Remove rounds associados às casas
            await prisma.round.deleteMany({
                where: {
                    houseId: { in: houseIds },
                    tenantId,
                },
            });
            this.logger.log(`Rounds associados removidos para casas: ${houseIds}`);

            // Remove as casas associadas
            await prisma.house.deleteMany({
                where: {
                    id: { in: houseIds },
                    tenantId,
                },
            });
            this.logger.log(`Casas removidas: ${houseIds}`);
        }
    }

    // Método para criar uma casa fantasma e seus rounds
    async createGhostHouse(addressId: number, territoryBlock: { blockId: number; territoryId: number }, territoryBlockAddressId: number, tenantId: number, prisma: PrismaTransaction) {
        this.logger.log(`Criando casa fantasma para endereço com ID: ${addressId}`);

        // house.create e round.findMany são independentes — rodar em paralelo
        const [house, fetchedRounds] = await Promise.all([
            prisma.house.create({
                data: {
                    addressId,
                    blockId: territoryBlock.blockId,
                    tenantId,
                    territoryId: territoryBlock.territoryId,
                    territoryBlockAddressId,
                    number: 'ghost',
                }
            }),
            prisma.round.findMany({
                where: { tenantId, endDate: null },
                select: { roundNumber: true },
                distinct: 'roundNumber',
            }),
        ]);
        this.logger.log(`Casa fantasma criada: ${house.id}`);

        let rounds = fetchedRounds;
        if (!rounds.length) {
            await prisma.round_info.create({
                data: {
                    roundNumber: 1,
                    name: "Inicial",
                    theme: ThemeMode.default,
                    colorPrimary: themeColors[ThemeMode.default].primary,
                    colorSecondary: themeColors[ThemeMode.default].secondary,
                    tenantId,
                }
            });
            this.logger.log(`Round info inicial criado.`);
            rounds = [{ roundNumber: 1 }];
        }

        await Promise.all(rounds.map(round =>
            prisma.round.create({
                data: {
                    blockId: territoryBlock.blockId,
                    tenantId,
                    territoryId: territoryBlock.territoryId,
                    houseId: house.id,
                    roundNumber: round.roundNumber,
                    completed: true,
                }
            })
        ));
        this.logger.log(`${rounds.length} round(s) criado(s) para casa fantasma: ${house.id}`);
    }

    async syncGhostHouses(territoryId: number, blockId: number, tenantId: number, prisma: PrismaTransaction = this.prisma) {
        const syncCacheKey = `sync:ghost:${tenantId}:${territoryId}:${blockId}`;
        const alreadySynced = await this.cacheManager.get(syncCacheKey);
        if (alreadySynced) {
            this.logger.log(`[CACHE HIT] syncGhostHouses ${syncCacheKey} — skip`);
            return;
        }
        this.logger.log(`Sincronizando casas fantasmas para o território ${territoryId} e quadra ${blockId}`);

        // Phase 1 e Phase 2 são SELECTs independentes — buscar em paralelo
        const [missingGhostHouses, ghostHousesToCleanup] = await Promise.all([
            prisma.territory_block_address.findMany({
                where: {
                    tenantId,
                    territoryBlock: { territoryId, blockId },
                    house: { none: {} },
                },
                include: { territoryBlock: true },
            }),
            prisma.house.findMany({
                where: { number: 'ghost', territoryId, blockId, tenantId },
            }),
        ]);

        // Phase 1: criar ghost houses em paralelo (cada TBA é independente)
        await Promise.all(
            missingGhostHouses.map(tba =>
                this.createGhostHouse(tba.addressId, tba.territoryBlock, tba.id, tenantId, prisma)
            )
        );

        // Phase 2: remover ghost houses que agora têm casas reais
        const tbAddressIds = [...new Set(
            ghostHousesToCleanup.map(g => g.territoryBlockAddressId).filter((id): id is number => id != null)
        )];

        let orphanGhostIds: number[] = [];
        if (tbAddressIds.length > 0) {
            const allHousesInAddresses = await prisma.house.findMany({
                where: { territoryBlockAddressId: { in: tbAddressIds }, tenantId },
                select: { id: true, number: true, territoryBlockAddressId: true },
            });

            orphanGhostIds = ghostHousesToCleanup
                .filter(ghostHouse => {
                    if (!ghostHouse.territoryBlockAddressId) return false;
                    const siblings = allHousesInAddresses.filter(
                        h => h.territoryBlockAddressId === ghostHouse.territoryBlockAddressId
                    );
                    return siblings.some(h => h.number !== 'ghost');
                })
                .map(g => g.id);

            if (orphanGhostIds.length > 0) {
                this.logger.log(`Removendo ${orphanGhostIds.length} casas fantasmas órfãs pois já existem casas reais: ${orphanGhostIds}`);
                await prisma.round.deleteMany({ where: { houseId: { in: orphanGhostIds }, tenantId } });
                await prisma.house.deleteMany({ where: { id: { in: orphanGhostIds }, tenantId } });
            }
        }

        // Só cacheia se o bloco está estável (nenhuma criação ou remoção de ghost houses)
        // Se houve trabalho, o próximo request roda sync de novo até estabilizar
        const didWork = missingGhostHouses.length > 0 || orphanGhostIds.length > 0;
        if (!didWork) {
            await this.cacheManager.set(syncCacheKey, true, TTL_SYNC_GHOST);
            this.logger.log(`[CACHE SET] syncGhostHouses ${syncCacheKey} — bloco estável, cache 24h`);
        } else {
            this.logger.log(`syncGhostHouses ${syncCacheKey} — trabalho realizado, sem cache`);
        }
    }

    async invalidateSyncGhostCache(tenantId: number, territoryId: number, blockId: number) {
        const syncCacheKey = `sync:ghost:${tenantId}:${territoryId}:${blockId}`;
        await this.cacheManager.del(syncCacheKey);
        this.logger.log(`[CACHE INVALIDATE] syncGhostHouses ${syncCacheKey}`);
    }

    async resolveTerritoryBlockAddressId(territoryId: number, blockId: number, addressId: number, tenantId: number): Promise<number> {
        const results = await this.prisma.territory_block_address.findMany({
            where: {
                tenantId,
                addressId,
                territoryBlock: {
                    territoryId,
                    blockId,
                },
            },
            select: { id: true },
        });

        if (results.length === 0) {
            throw new BadRequestException(
                `Nenhum mapeamento territory_block_address encontrado para territoryId=${territoryId}, blockId=${blockId}, addressId=${addressId}`
            );
        }

        if (results.length > 1) {
            throw new BadRequestException(
                `Mapeamento ambíguo: ${results.length} registros territory_block_address encontrados para territoryId=${territoryId}, blockId=${blockId}, addressId=${addressId}`
            );
        }

        return results[0].id;
    }
}
