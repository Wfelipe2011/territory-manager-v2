import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';

@Injectable()
export class DashboardService {
  constructor(readonly prisma: PrismaService) {}

  async findMarkedHouses(tenantId: number) {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const data = await this.prisma.$queryRaw<any>`
    SELECT
        TO_CHAR(r.update_date, 'YYYY-MM-01') AS date,
        CAST(SUM(CASE WHEN t.name = 'Residencial' THEN 1 ELSE 0 END) AS INT) AS residential,
        CAST(SUM(CASE WHEN t.name = 'Comercial' THEN 1 ELSE 0 END) AS INT) AS commercial
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
        AND r.update_date >= ${oneYearAgo}
    GROUP BY
        TO_CHAR(r.update_date, 'YYYY-MM-01')
    ORDER BY
        date;
    `;
    return data;
  }

  async territoryDetails(tenantId: number) {
    const data = await this.prisma.$queryRaw<any>`
    SELECT
      CAST(SUM(CASE WHEN t.name = 'Residencial' THEN 1 ELSE 0 END) AS INT) AS residential,
      CAST(SUM(CASE WHEN t.name = 'Comercial' THEN 1 ELSE 0 END) AS INT) AS commercial,
      CAST(SUM(CASE WHEN t.name IN ('Interfone', 'Predial-Interno', 'Predial-Externo') THEN 1 ELSE 0 END) AS INT) AS building,
      CAST(SUM(1) AS INT) AS total
    FROM
      territory tr
    JOIN
      type t ON tr.type_id = t.id
    JOIN
      house h ON tr.id = h.territory_id
    WHERE
      h.tenant_id = ${tenantId}
    `;
    return data[0];
  }
}
