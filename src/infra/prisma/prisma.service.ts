import { Prisma, PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

export class PrismaService extends PrismaClient {
  private logger = new Logger(PrismaService.name);
  public isConnected = false;

  constructor() {
    super();
    this.$on('connect' as never, () => {
      this.isConnected = true;
      this.logger.debug('🔌 Conexão estabelecida com o banco de dados.');
    });

    process.on('beforeExit' as never, () => {
      this.isConnected = false;
      this.logger.warn('⚠️ Conexão com o banco de dados foi perdida.');
    });

    this.$on('error' as never, (error: any) => {
      const msg = error?.message ?? error?.toString?.() ?? '<sem mensagem>';
      const code = error?.code ? `[${error.code}]` : '';
      this.logger.error(`🔥 Erro no Prisma ${code}: ${msg}`);

      const losesConnection =
        error instanceof Prisma.PrismaClientInitializationError ||
        error instanceof Prisma.PrismaClientRustPanicError ||
        /connection|reset|refused|timed out|EHOSTUNREACH|ECONNRESET|EPIPE/i.test(msg);

      if (losesConnection) {
        this.isConnected = false;
        this.logger.warn('Conexão considerada perdida; próxima chamada tentará reconectar.');
      }
    });
  }

  async connectToDatabase() {
    if (this.isConnected) return;

    let retries = 5;
    while (retries > 0) {
      try {
        await this.$connect();
        this.isConnected = true;
        this.logger.debug('✅ Banco conectado com sucesso.');
        return;
      } catch (error) {
        this.logger.warn(`Tentativa ${6 - retries} de reconexão falhou: ${error.message}`);
        retries--;
        await new Promise((res) => setTimeout(res, (5 - retries) * 1000)); // Backoff exponencial
      }
    }

    this.logger.error('❌ Não foi possível reconectar ao banco após várias tentativas.');
  }

  async onModuleInit() {
    await this.connectToDatabase();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.isConnected = false;
    this.logger.log('🔌 Conexão com o banco encerrada.');
  }
}
