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

    const typeColumns = topTypes.length > 0
      ? topTypes
        .map((type) => `CAST(SUM(CASE WHEN h.legend = '${type.legend}' THEN 1 ELSE 0 END) AS INT) AS "${type.legend}"`)
        .join(',\n ') + ','
      : '';
    const data = await this.prisma.$queryRawUnsafe<any>(`
    SELECT
      ${typeColumns}
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

  async getBusinessMetrics() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 1. Identificar as congregações ativas (IDs)
    const activeTenants = await this.prisma.multitenancy.findMany({
      where: {
        round: {
          some: {
            OR: [
              { updateDate: { gte: thirtyDaysAgo } },
              { startDate: { gte: thirtyDaysAgo } },
              { completedDate: { gte: thirtyDaysAgo } },
            ],
          },
        },
      },
      select: {
        id: true,
        name: true,
        city: true,
        round: {
          where: {
            OR: [
              { updateDate: { gte: thirtyDaysAgo } },
              { startDate: { gte: thirtyDaysAgo } },
              { completedDate: { gte: thirtyDaysAgo } },
            ],
          },
          orderBy: { updateDate: 'desc' },
          take: 1,
          select: {
            updateDate: true,
          }
        },
        _count: {
          select: {
            users: true,
            territories: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const activeIds = activeTenants.map(t => t.id);

    // 2. Buscar as métricas filtradas apenas para estas congregações ativas
    const [houses, territories, users, financial, totalTenantsCount] = await Promise.all([
      this.prisma.house.count({ where: { tenantId: { in: activeIds } } }),
      this.prisma.territory.count({ where: { tenantId: { in: activeIds } } }),
      this.prisma.user.count({ where: { tenantId: { in: activeIds } } }),
      this.prisma.financial_entry.aggregate({
        where: {
          type: 'POSITIVE',
          tenantId: { in: activeIds }
        },
        _sum: {
          value: true,
        },
      }),
      this.prisma.multitenancy.count() // Mantemos o total global apenas para referência se precisar
    ]);

    // Calcular atividade (territórios sendo trabalhados agora em tenants ativos)
    const activeSignatures = await this.prisma.territory_overseer.count({
      where: {
        finished: false,
        tenantId: { in: activeIds }
      }
    });

    return {
      totalTenants: totalTenantsCount,
      activeTenants: activeIds.length,
      totalHouses: houses,
      totalTerritories: territories,
      totalUsers: users,
      activeTenantsList: activeTenants.map(t => ({
        ...t,
        lastActivity: t.round[0]?.updateDate || null
      })),
      activeSignatures,
      globalBalance: financial._sum.value || 0,
    };
  }
}
