import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(readonly prisma: PrismaService) { }

  async findMarkedHouses(tenantId: number) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAgoString = oneYearAgo.toISOString();

    const topLegends = await this.prisma.$queryRawUnsafe<{ legend: string; count: number }[]>(`
      SELECT legend, COUNT(*) as count
      FROM house
      WHERE tenant_id = ${tenantId}
      GROUP BY legend
      ORDER BY count DESC
      LIMIT 4
    `);

    const legendColumns = topLegends
      .map((legend) => `CAST(SUM(CASE WHEN h.legend = '${legend.legend}' THEN 1 ELSE 0 END) AS INT) AS "${legend.legend}"`)
      .join(',\n ');

    const data = await this.prisma.$queryRawUnsafe<any>(`
      SELECT
          TO_CHAR(r.completed_date, 'YYYY-MM-DD') AS date,
          ${legendColumns}
      FROM
          "round" r
      JOIN
          house h ON r.house_id = h.id
      WHERE
          r.completed = TRUE
          AND r.tenant_id = ${tenantId}
          AND r.completed_date >= '${oneYearAgoString}'
      GROUP BY
          TO_CHAR(r.completed_date, 'YYYY-MM-DD')
      ORDER BY
          date;
`).catch((err) => {
      console.log(err);
      return [];
    })
    return data;
  }

  async territoryDetails(tenantId: number) {
    const topTypes = await this.prisma.$queryRawUnsafe<{ legend: string; count: number }[]>(`
      SELECT legend, COUNT(*) as count
      FROM house
      WHERE tenant_id = ${tenantId}
      GROUP BY legend
      ORDER BY count DESC
      LIMIT 4
    `);

    const typeColumns = topTypes
      .map((type) => `CAST(SUM(CASE WHEN h.legend = '${type.legend}' THEN 1 ELSE 0 END) AS INT) AS "${type.legend}"`) // ✅ Corrigido aqui
      .join(',\n ');
    const data = await this.prisma.$queryRawUnsafe<any>(`
    SELECT
      ${typeColumns},
      CAST(SUM(1) AS INT) AS total
    FROM
      house h
    WHERE
      h.tenant_id = ${tenantId}
    `).catch((err) => {
      console.log(err);
      return [{
        "Residencial": 0,
        "total": 0
      }];
    });

    return data[0];
  }
}
