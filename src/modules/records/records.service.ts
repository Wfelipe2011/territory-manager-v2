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
    select distinct 
      t.name as "Território",
      t2."name" as "Tipo Território",
      to2.overseer as "Dirigente",
      to2.initial_date as "Data Designação",
      to2.round_number as "Rodada"
    from
      territory_overseer to2
    inner join territory t on
      t.id = to2.territory_id
    inner join "type" t2 on
      t2.id = t.type_id
    inner join round r on
      r.territory_id = to2.territory_id
      and r.tenant_id = to2.tenant_id
    where
      to2.tenant_id = ${tenant_id}
      and to2.initial_date >= ${dayjs(dateFrom).toDate()}
      and to2.initial_date <= ${dayjs(dateTo).toDate()}
      and r.update_date is not null
      and r.update_date >= to2.initial_date
      and (
        to2.expiration_date is null or
        r.update_date <= to2.expiration_date
      )
    order by
      to2.round_number desc,
      t.name asc,
      to2.initial_date desc
    `;
  }
}
