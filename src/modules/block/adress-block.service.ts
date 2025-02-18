import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { UserToken } from '../auth/contracts';
import { PrismaTransaction } from 'src/infra/prisma';

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

        // Se não há endereços, deleta todos
        if (!addresses.length) {
            await prisma.territory_block_address.deleteMany({ where: { territoryBlockId } });
            this.logger.log('Todos os endereços foram removidos');
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

        const addressIds = upsertedAddresses.map((a) => a.id);

        // Busca endereços existentes associados ao bloco
        const existingAddresses = await prisma.territory_block_address.findMany({
            where: { territoryBlockId },
        });

        const existingAddressIds = existingAddresses.map((a) => a.addressId);

        // Deleta endereços que não estão mais na lista
        const addressesToDelete = existingAddressIds.filter((id) => !addressIds.includes(id));
        if (addressesToDelete.length) {
            await prisma.territory_block_address.deleteMany({
                where: { addressId: { in: addressesToDelete }, territoryBlockId },
            });
            this.logger.log(`Removidos os endereços: ${addressesToDelete}`);
        }

        // Adiciona novos endereços
        const newAddresses = addressIds.filter((id) => !existingAddressIds.includes(id));
        for (const addressId of newAddresses) {
            await prisma.territory_block_address.create({
                data: { addressId, territoryBlockId, tenantId },
            });
            this.logger.log(`Adicionado endereço com ID: ${addressId}`);
        }
    }
}
