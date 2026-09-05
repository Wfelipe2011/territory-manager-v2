import { ConflictException } from '@nestjs/common';
import { HouseService } from '../modules/house/house.service';

describe('HouseService.create (regras: duplicidade 409, transação, ghost, rounds)', () => {
  let tx: Record<string, Record<string, jest.Mock>>;
  let prisma: Record<string, unknown>;
  let addressBlockService: Record<string, jest.Mock>;
  let cacheManager: Record<string, jest.Mock>;
  let service: HouseService;

  const input = { streetId: 1, number: '12', legend: '', dontVisit: false, territoryId: 3, blockId: 2 };

  beforeEach(() => {
    tx = {
      house: {
        findFirst: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      round: {
        findMany: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    prisma = {
      address: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
      block: { findUnique: jest.fn().mockResolvedValue({ id: 2 }) },
      territory: { findUnique: jest.fn().mockResolvedValue({ id: 3, tenantId: 10 }) },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    addressBlockService = {
      resolveTerritoryBlockAddressId: jest.fn().mockResolvedValue(99),
      invalidateSyncGhostCache: jest.fn(),
    };
    cacheManager = { del: jest.fn() };
    service = new HouseService(prisma as never, {} as never, addressBlockService as never, cacheManager as never);
  });

  it('cria casa, remove ghost do TBA, cria rounds nas rodadas abertas e invalida caches', async () => {
    tx.house.findFirst.mockResolvedValueOnce(null); // duplicidade: não existe
    tx.house.create.mockResolvedValue({ id: 7, number: '12' });
    tx.house.findFirst.mockResolvedValueOnce({ id: 5, number: 'ghost' }); // ghost encontrado
    tx.round.findMany.mockResolvedValue([{ roundNumber: 1 }, { roundNumber: 2 }]);
    tx.round.createMany.mockResolvedValue({ count: 2 });

    const result = await service.create(input);

    expect(tx.house.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ number: '12', multitenancy: { connect: { id: 10 } } }) })
    );
    // Ghost removido (rounds + house)
    expect(tx.round.deleteMany).toHaveBeenCalledWith({ where: { houseId: 5 } });
    expect(tx.house.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    // Rounds via createMany, somente nas rodadas abertas
    expect(tx.round.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ roundNumber: 1, houseId: 7, completed: false }),
        expect.objectContaining({ roundNumber: 2, houseId: 7, completed: false }),
      ],
    });
    // Retorno carrega os round numbers para o evento
    expect(result.openRoundNumbers).toEqual([1, 2]);
    // Caches invalidados: addresses + houses por rodada
    expect(cacheManager.del).toHaveBeenCalledWith('addresses:3:2');
    expect(cacheManager.del).toHaveBeenCalledWith('houses:3:2:1:1');
    expect(cacheManager.del).toHaveBeenCalledWith('houses:3:2:1:2');
    expect(addressBlockService.invalidateSyncGhostCache).toHaveBeenCalledWith(10, 3, 2);
  });

  it('segunda casa com o mesmo número no mesmo TBA: lança ConflictException (409) e NÃO cria', async () => {
    tx.house.findFirst.mockResolvedValueOnce({ id: 7, number: '12' }); // já existe

    await expect(service.create(input)).rejects.toThrow(ConflictException);
    expect(tx.house.create).not.toHaveBeenCalled();
    expect(tx.round.createMany).not.toHaveBeenCalled();
  });

  it('falha na criação dos rounds: exceção propaga e nada é criado fora da transação', async () => {
    tx.house.findFirst.mockResolvedValueOnce(null);
    tx.house.create.mockResolvedValue({ id: 7, number: '12' });
    tx.house.findFirst.mockResolvedValueOnce(null);
    tx.round.findMany.mockResolvedValue([{ roundNumber: 1 }]);
    tx.round.createMany.mockRejectedValue(new Error('falha no createMany'));

    await expect(service.create(input)).rejects.toThrow('falha no createMany');
    // Tudo acontece dentro de $transaction — sem chamadas fora dela após o erro
    expect(cacheManager.del).not.toHaveBeenCalled();
    expect(addressBlockService.invalidateSyncGhostCache).not.toHaveBeenCalled();
  });
});
