import { Global, Module } from '@nestjs/common';
import { FieldAccessService } from './field-access.service';
import { FieldService } from './field.service';
import { FieldController } from './field.controller';
import { CatalogRoundService } from '../round/catalog-round.service';

@Global()
@Module({
  providers: [FieldAccessService, FieldService, CatalogRoundService],
  controllers: [FieldController],
  exports: [FieldAccessService, FieldService, CatalogRoundService],
})
export class FieldModule {}
