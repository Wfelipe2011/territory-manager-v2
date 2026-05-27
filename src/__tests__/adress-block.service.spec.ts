import { BadRequestException } from '@nestjs/common';
import { AddressBlockService } from '../modules/block/adress-block.service';

describe('AddressBlockService - resolveTerritoryBlockAddressId', () => {
    let service: AddressBlockService;
    let findManyMock: jest.Mock;

    beforeEach(() => {
        findManyMock = jest.fn();
        const mockPrisma = {
            territory_block_address: {
                findMany: findManyMock,
            },
        } as any;
        const mockCache = { del: jest.fn(), get: jest.fn(), set: jest.fn() } as any;
        service = new AddressBlockService(mockPrisma, mockCache);
    });

    it('deve retornar o id quando o triplete resolve para exatamente um registro', async () => {
        findManyMock.mockResolvedValue([{ id: 42 }]);

        const result = await service.resolveTerritoryBlockAddressId(1, 2, 3, 10);

        expect(result).toBe(42);
        expect(findManyMock).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenantId: 10, addressId: 3 }),
            }),
        );
    });

    it('deve lançar BadRequestException quando nenhum registro for encontrado', async () => {
        findManyMock.mockResolvedValue([]);

        await expect(service.resolveTerritoryBlockAddressId(1, 2, 99, 10))
            .rejects
            .toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando múltiplos registros forem encontrados (mapeamento ambíguo)', async () => {
        findManyMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);

        await expect(service.resolveTerritoryBlockAddressId(1, 2, 3, 10))
            .rejects
            .toThrow(BadRequestException);
    });
});
