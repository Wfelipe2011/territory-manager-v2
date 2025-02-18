import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { PrismaTransaction } from 'src/infra/prisma';
import { ThemeMode } from '@prisma/client';
import { themeColors } from 'src/constants/themeColors';

interface AddressDto {
    id?: number;
    street: string;
    zipCode: string;
}

@Injectable()
export class AddressBlockService {
    private readonly logger = new Logger(AddressBlockService.name);

    constructor(private readonly prisma: PrismaService) { }

    async manageAddresses(territoryBlockId: number, addresses: AddressDto[] = [], tenantId: number, prisma: PrismaTransaction = this.prisma) {
        this.logger.log('Gerenciando endereços associados');

        const territoryBlock = await prisma.territory_block.findUnique({ where: { id: territoryBlockId } });
        this.logger.log(`Territory Block encontrado: ${JSON.stringify(territoryBlock)}`);

        // Se não há endereços, remove tudo (endereços, casas e rounds)
        if (!addresses.length) {
            this.logger.log('Nenhum endereço fornecido. Removendo todas as associações.');

            const existingAddresses = await prisma.territory_block_address.findMany({ where: { territoryBlockId } });
            const existingAddressIds = existingAddresses.map((a) => a.id);

            await this.deleteHousesAndRounds(existingAddressIds, territoryBlockId, tenantId, prisma);
            await prisma.territory_block_address.deleteMany({ where: { territoryBlockId } });

            this.logger.log('Todas as associações foram removidas.');
            return;
        }

        // Upsert de endereços
        const upsertedAddresses = await Promise.all(
            addresses.map((address) =>
                prisma.address.upsert({
                    where: { id: address.id ?? 0 },
                    update: { name: address.street, zipCode: address.zipCode, tenantId },
                    create: { name: address.street, zipCode: address.zipCode, tenantId },
                })
            )
        );
        this.logger.log(`Endereços upserted: ${JSON.stringify(upsertedAddresses)}`);

        const addressIds = upsertedAddresses.map((a) => a.id);

        // Busca endereços existentes associados ao bloco
        const existingAddresses = await prisma.territory_block_address.findMany({
            where: { territoryBlockId },
        });
        this.logger.log(`Endereços existentes: ${JSON.stringify(existingAddresses)}`);

        const existingAddressIds = existingAddresses.map((a) => a.addressId);

        // Deleta endereços que não estão mais na lista
        const addressesToDelete = existingAddressIds.filter((id) => !addressIds.includes(id));
        if (addressesToDelete.length) {
            this.logger.log(`Removendo os endereços: ${addressesToDelete}`);
            const territoryBlockAddress = await prisma.territory_block_address.findMany({
                where: {
                    territoryBlockId,
                    addressId: { in: addressesToDelete }
                },
                select: {
                    id: true
                }
            })
            const territoryBlockAddressIds = territoryBlockAddress.map(tba => tba.id)
            await this.deleteHousesAndRounds(territoryBlockAddressIds, territoryBlockId, tenantId, prisma);
            await prisma.territory_block_address.deleteMany({
                where: { id: { in: territoryBlockAddressIds } },
            });
            this.logger.log(`Endereços removidos: ${addressesToDelete}`);
        }

        // Adiciona novos endereços e cria casas fantasmas
        const newAddresses = addressIds.filter((id) => !existingAddressIds.includes(id));
        for (const addressId of newAddresses) {
            const territoryBlockAddress = await prisma.territory_block_address.create({
                data: { addressId, territoryBlockId, tenantId },
            });
            this.logger.log(`Adicionado endereço com ID: ${addressId}`);

            // Criação de casa fantasma, se necessário
            const house = await prisma.house.findFirst({
                where: {
                    addressId,
                    blockId: territoryBlock?.blockId,
                    tenantId,
                    territoryId: territoryBlock?.territoryId,
                    territoryBlockAddressId: territoryBlockAddress.id
                }
            });

            if (!house) {
                await this.createGhostHouse(addressId, territoryBlock, territoryBlockAddress.id, tenantId, prisma);
            }
        }
    }

    // Método para deletar casas e rounds associados
    private async deleteHousesAndRounds(territoryBlockAddressIds: number[], territoryBlockId: number, tenantId: number, prisma: PrismaTransaction) {
        this.logger.log(`Iniciando remoção de casas e rounds associados aos endereços: ${territoryBlockAddressIds}`);

        // Busca casas associadas aos endereços
        const houses = await prisma.house.findMany({
            where: {
                territoryBlockAddressId: { in: territoryBlockAddressIds },
                blockId: (await prisma.territory_block.findUnique({ where: { id: territoryBlockId } }))?.blockId,
                tenantId,
            },
            select: { id: true }
        });
        const houseIds = houses.map(h => h.id);

        if (houseIds.length) {
            // Remove rounds associados às casas
            await prisma.round.deleteMany({
                where: { houseId: { in: houseIds } }
            });
            this.logger.log(`Rounds associados removidos para casas: ${houseIds}`);

            // Remove as casas associadas
            await prisma.house.deleteMany({
                where: { id: { in: houseIds } }
            });
            this.logger.log(`Casas fantasmas removidas: ${houseIds}`);
        }
    }

    // Método para criar uma casa fantasma e seus rounds
    private async createGhostHouse(addressId: number, territoryBlock: any, territoryBlockAddressId: number, tenantId: number, prisma: PrismaTransaction) {
        this.logger.log(`Criando casa fantasma para endereço com ID: ${addressId}`);
        const house = await prisma.house.create({
            data: {
                addressId,
                blockId: territoryBlock?.blockId!,
                tenantId,
                territoryId: territoryBlock?.territoryId!,
                territoryBlockAddressId,
                number: 'ghost',
            }
        });
        this.logger.log(`Casa fantasma criada: ${JSON.stringify(house)}`);

        let rounds = await prisma.round.findMany({
            where: { tenantId, endDate: null, },
            select: { roundNumber: true },
            distinct: 'roundNumber'
        });

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

        for (const round of rounds) {
            await prisma.round.create({
                data: {
                    blockId: territoryBlock?.blockId!,
                    tenantId,
                    territoryId: territoryBlock?.territoryId!,
                    houseId: house.id,
                    roundNumber: round.roundNumber,
                    completed: true
                }
            });
            this.logger.log(`Round criado para casa fantasma: ${house.id}, round: ${round.roundNumber}`);
        }
    }
}
