import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export interface RecordsData {
  Território: string;
  "Tipo Território": string;
  Dirigente: string;
  "Data Designação": Date;
  Rodada: number;
}


@Injectable()
export class RecordsService {
  logger = new Logger(RecordsService.name);
  constructor(private prismaService: PrismaService) { }
  async find(tenant_id: number, dateFrom: string, dateTo: string) {
    return this.prismaService.$queryRaw<RecordsData[]>`
    select
      t.name as "Território",
      t2."name" as "Tipo Território",
      to2.overseer as "Dirigente",
      to2.initial_date as "Data Designação",
      to2.round_number as "Rodada"
    from
      territory_overseer to2
    inner join territory t on
      t.id = to2.territory_id
    inner join "type" t2 on t2.id = t.type_id 
    where
      to2.tenant_id = ${tenant_id}
      and to2.initial_date >= ${dayjs(dateFrom).toDate()}
      and to2.initial_date <= ${dayjs(dateTo).toDate()}
    order by
      round_number desc,
      t.name asc,
      to2.initial_date desc
    `;
  }
}
