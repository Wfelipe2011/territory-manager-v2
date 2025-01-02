import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  logger = new Logger(PrismaService.name);
  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
      ],
    });
    // @ts-ignore
    this.$on('query', (e: any) => {
      this.logger.debug('Query: ' + e.query)
      this.logger.debug('Params: ' + e.params)
      this.logger.debug('Duration: ' + e.duration + 'ms')
    })
  }
  async onModuleInit() {
    await this.$connect();
  }
}
