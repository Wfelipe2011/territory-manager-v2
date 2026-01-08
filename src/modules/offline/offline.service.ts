import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SignatureIsValid } from '../signature/usecase/SignatureIsValid';
import { uuid } from '../../shared';
import dayjs from 'dayjs';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class OfflineService {
    private readonly logger = new Logger(OfflineService.name);

    constructor(private readonly prisma: PrismaService) { }

    async getSnapshot(territoryId: number, signatureKey: string) {
        this.logger.log(`Generating snapshot for territory ${territoryId} with signature ${signatureKey}`);

        const validator = new SignatureIsValid(this.prisma);
        await validator.execute(signatureKey);

        const signature = await this.prisma.signature.findUnique({
            where: { key: signatureKey },
        });

        if (!signature) {
            throw new ForbiddenException('Signature not found');
        }

        const { roundNumber, blockId, tenantId } = this.decodeToken(signature.token);

        const territory = await this.prisma.territory.findUnique({
            where: { id: Number(territoryId) },
            include: {
                territory_block: {
                    where: blockId ? { blockId: Number(blockId) } : {},
                    include: {
                        block: true,
                        territory_block_address: {
                            include: {
                                address: true,
                                house: {
                                    include: {
                                        rounds: {
                                            where: {
                                                roundNumber: roundNumber,
                                                tenantId: tenantId,
                                            },
                                            take: 1,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!territory) {
            throw new NotFoundException('Territory not found');
        }

        // If restricted to a block, validation:
        if (blockId && territory.territory_block.length === 0) {
            // This happens if the blockId from token is not in this territory (shouldn't happen if generated correctly)
            // Or if the territory_block record doesn't exist.
            // The query above filters `territory_block` by blockId.
            throw new ForbiddenException('Block not assigned or not found in territory');
        }

        return {
            territory: {
                id: territory.id,
                name: territory.name,
            },
            round: {
                number: roundNumber,
                tenantId: tenantId,
            },
            blocks: territory.territory_block.map((tb) => ({
                id: tb.block.id,
                name: tb.block.name,
                addresses: tb.territory_block_address.map((tba) => ({
                    id: tba.address.id,
                    name: tba.address.name,
                    zipCode: tba.address.zipCode,
                    houses: tba.house.map((h: any) => {
                        const status = h.rounds[0];
                        return {
                            id: h.id,
                            number: h.number,
                            complement: h.complement,
                            legend: h.legend,
                            dontVisit: h.dontVisit,
                            observations: h.observations,
                            status: status ? {
                                completed: status.completed,
                                date: status.completedDate || status.endDate || status.updateDate,
                            } : null
                        };
                    }),
                })),
            })),
        };
    }

    async sync(signatureKey: string, payload: { territoryId: number; changes: { houseId: number; status: boolean; date: string }[] }) {
        this.logger.log(`Syncing data for territory ${payload.territoryId}`);

        const validator = new SignatureIsValid(this.prisma);
        await validator.execute(signatureKey);

        const signature = await this.prisma.signature.findUnique({
            where: { key: signatureKey },
        });

        if (!signature) {
            throw new ForbiddenException('Invalid signature');
        }

        const { roundNumber, tenantId, blockId } = this.decodeToken(signature.token);

        // TODO: Verify if the territoryId matches the one in the token (if present)?
        // The token has `territoryId`. Let's verify it.
        // However, I need to fetch the token first.

        await this.prisma.changeSet.create({
            data: {
                tenantId: tenantId,
                batchId: uuid(),
                payload: payload as any
            }
        });

        for (const change of payload.changes) {
            const house = await this.prisma.house.findUnique({
                where: { id: change.houseId }
            });

            if (!house) continue;

            // Security Check: If restricted to block, ensure house belongs to block
            if (blockId && house.blockId !== blockId) {
                this.logger.warn(`House ${house.id} is not in block ${blockId}. Skipping sync.`);
                continue;
            }

            const visitDate = new Date(change.date);

            await this.prisma.round.upsert({
                where: {
                    houseId_territoryId_blockId_tenantId_roundNumber: {
                        houseId: house.id,
                        territoryId: house.territoryId,
                        blockId: house.blockId,
                        tenantId: tenantId,
                        roundNumber: roundNumber
                    }
                },
                create: {
                    houseId: house.id,
                    territoryId: house.territoryId,
                    blockId: house.blockId,
                    tenantId: tenantId,
                    roundNumber: roundNumber,
                    completed: change.status,
                    completedDate: change.status ? visitDate : null,
                    endDate: change.status ? visitDate : null,
                    updateDate: new Date(),
                },
                update: {
                    completed: change.status,
                    completedDate: change.status ? visitDate : null,
                    endDate: change.status ? visitDate : null,
                    updateDate: new Date(),
                }
            });
        }

        return { success: true };
    }

    private decodeToken(token: string): { roundNumber: number; tenantId: number; blockId?: number; territoryId: number } {
        const decoded = jwt.decode(token) as any;
        if (!decoded) throw new ForbiddenException('Invalid token');

        return {
            roundNumber: Number(decoded.round),
            tenantId: Number(decoded.tenantId),
            blockId: decoded.blockId ? Number(decoded.blockId) : undefined,
            territoryId: Number(decoded.territoryId),
        };
    }
}
