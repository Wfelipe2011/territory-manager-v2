import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(readonly prisma: PrismaService) { }

  async findMarkedHouses(tenantId: number) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAgoString = oneYearAgo.toISOString();
    const types = await this.prisma.type.findMany({ where: { tenantId: tenantId } });
    const typeColumns = types
      .map((type) => `CAST(SUM(CASE WHEN t.name = '${type.name}' THEN 1 ELSE 0 END) AS INT) AS "${type.name}"`) // ✅ Corrigido aqui
      .join(',\n ');

    const data = await this.prisma.$queryRawUnsafe<any>(`
      SELECT
          TO_CHAR(r.completed_date, 'YYYY-MM-01') AS date,
          ${typeColumns}
      FROM
          round r
      JOIN
          house h ON r.house_id = h.id
      JOIN
          territory tr ON h.territory_id = tr.id
      JOIN
          type t ON tr.type_id = t.id
      WHERE
          r.completed = TRUE
          AND r.tenant_id = ${tenantId}
          AND r.completed_date >= '${oneYearAgoString}'
      GROUP BY
          TO_CHAR(r.completed_date, 'YYYY-MM-01')
      ORDER BY
          date;
`);
    return data;
  }

  async territoryDetails(tenantId: number) {
    const types = await this.prisma.type.findMany({ where: { tenantId: tenantId } });
    const typeColumns = types
      .map((type) => `CAST(SUM(CASE WHEN t.name = '${type.name}' THEN 1 ELSE 0 END) AS INT) AS "${type.name}"`) // ✅ Corrigido aqui
      .join(',\n ');
    const data = await this.prisma.$queryRawUnsafe<any>(`
    SELECT
      ${typeColumns},
      CAST(SUM(1) AS INT) AS total
    FROM
      territory tr
    JOIN
      type t ON tr.type_id = t.id
    JOIN
      house h ON tr.id = h.territory_id
    WHERE
      h.tenant_id = ${tenantId}
    `);
    return data[0];
  }
}
