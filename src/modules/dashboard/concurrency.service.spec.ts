import { ConcurrencyService } from './concurrency.service';
import { PrismaService } from '../../infra/prisma/prisma.service';

describe('Coletor de simultaneidade', () => {
  let service: ConcurrencyService;
  beforeEach(() => { jest.useFakeTimers(); service = new ConcurrencyService({} as PrismaService); });
  afterEach(async () => { await service.onModuleDestroy(); jest.useRealTimers(); });

  it('coleta sem visitas ao dashboard, repete a cada 30 segundos e encerra o timer', async () => {
    const collect = jest.spyOn(service, 'collect').mockResolvedValue();
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(collect).toHaveBeenCalledTimes(2);
    await service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('não sobrepõe uma coleta lenta com a próxima', async () => {
    let finish!: () => void;
    const collect = jest.spyOn(service, 'collect').mockReturnValue(new Promise(resolve => { finish = resolve; }));
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(collect).toHaveBeenCalledTimes(1);
    finish();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('tenta novamente após falha transitória sem gravar dados inventados', async () => {
    const collect = jest.spyOn(service, 'collect').mockRejectedValueOnce(new Error('offline')).mockResolvedValue();
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(collect).toHaveBeenCalledTimes(2);
  });
});
