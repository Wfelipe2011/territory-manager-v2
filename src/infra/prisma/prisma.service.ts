import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

export class PrismaService extends PrismaClient {
  private logger = new Logger(PrismaService.name);
  public isConnected = false;

  constructor() {
    super();
    this.$on('connect' as never, () => {
      this.isConnected = true;
      this.logger.log('🔌 Conexão estabelecida com o banco de dados.');
    });

    process.on('beforeExit' as never, () => {
      this.isConnected = false;
      this.logger.warn('⚠️ Conexão com o banco de dados foi perdida.');
    });

    this.$on('error' as never, (error) => {
      this.isConnected = false;
      this.logger.error(`🔥 Erro no Prisma: `, error);
    });
  }

  async connectToDatabase() {
    if (this.isConnected) return;

    let retries = 5;
    while (retries > 0) {
      try {
        await this.$connect();
        this.logger.log('✅ Banco conectado com sucesso.');
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
