import { Global, Module } from '@nestjs/common';
import { PgbossService } from './pgboss.service';

@Global()
@Module({
  providers: [PgbossService],
  exports: [PgbossService],
})
export class PgbossModule {}
