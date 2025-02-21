import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { TerritoryAllInput, TerritoryAllOutput, TerritoryOneOutput, TerritoryTypesOutput } from './contracts';
import { RawTerritoryAll, RawTerritoryOne } from './interfaces';
import { Prisma } from '@prisma/client';
import { CreateTerritoryParams } from './contracts/UpsertTerritoryParams';

@Injectable()
export class TerritoryService {
  private readonly logger = new Logger(TerritoryService.name);
  constructor(readonly prisma: PrismaService) { }

  async findAll(territoryDto: TerritoryAllInput, tenantId: number): Promise<TerritoryAllOutput[]> {
    const { filter = '', type } = territoryDto;
    this.logger.log(`Buscando territórios com filtro: ${filter}`);
    const territories = (await this.prisma.$queryRaw`
      SELECT 
          t.id as territory_id,
          t.type_id,
          t.name,
          to2.overseer,
          s.key,
          s.expiration_date,
          COUNT(r.id) > 0 as has_rounds,
          ARRAY_REMOVE(ARRAY_AGG(CASE WHEN r.completed THEN r.update_date END), NULL) as positive_completed,
          SUM(CASE WHEN NOT r.completed THEN 1 ELSE 0 END) as negative_completed
      FROM territory t
      INNER JOIN round r ON r.territory_id = t.id and r.round_number = ${+territoryDto.round}
      LEFT JOIN territory_overseer to2 ON to2.territory_id = t.id AND to2.signature_id IS NOT NULL AND to2.round_number = ${+territoryDto.round}
      LEFT JOIN signature s ON s.id = to2.signature_id
      WHERE t.tenant_id = ${+tenantId}
      ${type ? Prisma.sql`AND t.type_id = ${+type}` : Prisma.empty}
      ${filter ? Prisma.sql`AND LOWER(t.name) LIKE '%' || ${filter.toLowerCase()} || '%'` : Prisma.empty} 
      GROUP BY t.id, t.name, to2.overseer, s.key, s.expiration_date
      ORDER BY t.name ASC;
    `) as RawTerritoryAll[];
    this.logger.log(`Territórios encontrados: ${territories.length}`);
    return territories.map(territory => new TerritoryAllOutput(territory));
  }

  async findById(territoryId: number, round: number): Promise<TerritoryOneOutput> {
    this.logger.log('Buscando detalhes do territórios');

    const territory = await this.prisma.$queryRaw<RawTerritoryOne[]>`
      SELECT
        t.id as territory_id,
        t.image_url,
        t."name" as territory_name,
        tb.signature_id as signature,
        COUNT(round.id) > 0 as has_rounds,
        tov.overseer,
        tov.initial_date,
        tov.finished,
        SUM(CASE WHEN round.completed THEN 1 ELSE 0 END) as positive_completed,
        SUM(CASE WHEN NOT round.completed THEN 1 ELSE 0 END) as negative_completed,
        b.id as block_id,
        b."name" as block_name,
        s."key" as signature_key,
        tov.expiration_date,
        s.expiration_date as signature_expiration_date
      FROM territory t
      LEFT JOIN territory_block tb ON tb.territory_id = t.id
      LEFT JOIN block b ON b.id = tb.block_id
      LEFT JOIN house h ON h.block_id = tb.block_id AND h.territory_id = tb.territory_id
      INNER JOIN round ON round.house_id = h.id  AND round.round_number = ${+round}
      left join territory_overseer tov on tov.territory_id = t.id AND tov.round_number = ${+round}
       left join signature s on s.id = tb.signature_id
      WHERE t.id = ${territoryId}
      GROUP BY t.id, t."name", tb.signature_id, b.id, b."name", tov.overseer, tov.finished, tov.initial_date, s."key", tov.expiration_date, s.expiration_date
      ORDER BY negative_completed DESC;
      `;
    if (!territory.length) throw new NotFoundException('Território não encontrado');
    const territoryDto = new TerritoryOneOutput(territory);
    if (!territoryDto.history.length) throw new NotFoundException(`Território: ${territoryDto.territoryName} não tem histórico`);
    if (territoryDto.history.filter(h => !h.finished).length === 0)
      throw new NotFoundException(`Território: ${territoryDto.territoryName} não tem histórico assinatura`);
    await Promise.all(
      [
        ...territoryDto.blocks.map(async block => {
          const houseGhost = await this.prisma.house.count({
            where: {
              territoryId,
              blockId: block.id,
              number: 'ghost'
            }
          })
          block.positiveCompleted -= houseGhost
        }),
        ...territoryDto.blocks.map(async block => {
          const like = `%${territoryId}-${block.id}%`;
          const [connections] = await this.prisma.$queryRaw<{ count: BigInt }[]>`
          select count(s.id)  from socket s 
          where s.room LIKE ${like};
        `;
          block.connections = +connections.count.toString();
        })
      ]
    );

    this.logger.log(`Território: ${territoryDto.territoryName}`);

    return territoryDto;
  }

  async findTerritoryTypes(tenantId: number): Promise<TerritoryTypesOutput[]> {
    return this.prisma.type.findMany({
      where: {
        tenantId,
      },
    });
  }

  async findBlockByTerritoryId(territoryId: number) {
    const result = await this.prisma.territory_block.findMany({
      where: {
        territoryId,
      },
      select: {
        block: true,
      },
      orderBy: {
        block: {
          name: 'asc',
        },
      },
    });

    return result.map(r => {
      const { tenantId, ...rest } = r.block;
      return {
        ...rest,
      };
    });
  }

  async findEditById(query: TerritoryEditQuery, pagination: { page: number; pageSize: number }): Promise<TerritoryEditOutput> {
    const { streetName, houseNumber } = this.processStreetFilter(query.streetFilter);
    const whereCondition = this.buildWhereCondition(query, streetName, houseNumber) as any;

    // Calcula os valores de skip e take para a paginação
    const skip = (pagination.page - 1) * pagination.pageSize;
    const take = pagination.pageSize;

    const result = await this.prisma.territory.findFirst({
      where: { id: query.territoryId },
      include: {
        territory_overseer: true,
        house: {
          where: whereCondition,
          skip: skip,
          take: take,
          include: { address: true },
        },
        territory_block: {
          include: { block: true },
        },
        type: true,
      },
    });

    const totalHousesByTerritory = await this.prisma.house.count({
      where: {
        territoryId: query.territoryId,
      },
    });

    // Conta o total de casas que satisfazem os critérios de pesquisa
    const totalHouses = await this.prisma.house.count({
      where: {
        territoryId: query.territoryId,
        ...whereCondition,
      },
    });

    // Calcula o total de páginas
    const totalPages = Math.ceil(totalHouses / pagination.pageSize);

    if (!result) throw new NotFoundException('Territorio não encontrado');

    return {
      name: result.name,
      typeName: result.type.name,
      imageUrl: result.imageUrl,
      totalHouse: totalHousesByTerritory,
      house: result.house.map(h => ({
        id: h.id,
        dontVisit: h.dontVisit,
        legend: h.legend,
        number: h.number,
        street: h.address.name,
        observations: h.observations,
        order: h.order,
      })),
      historyOverseer: result.territory_overseer.map(t => ({
        overseer: t.overseer,
        finished: t.finished,
        initialDate: t.initialDate,
        expirationDate: t.expirationDate,
        roundNumber: t.roundNumber,
      })),
      pagination: {
        totalHouses,
        totalPages,
        currentPage: pagination.page,
        pageSize: pagination.pageSize,
      },
    };
  }

  async create(params: CreateTerritoryParams, tenantId: number) {
    return this.prisma.territory.create({
      data: {
        tenantId,
        name: params.name,
        typeId: params.typeId
      }
    })
  }

  async update(territoryId: number, params: CreateTerritoryParams) {
    return this.prisma.territory.update({
      where: {
        id: territoryId
      },
      data: {
        name: params.name,
        typeId: params.typeId
      }
    })
  }

  processStreetFilter(streetFilter?: string) {
    let streetName = streetFilter || '';
    let houseNumber = '';

    if (streetName.includes('+')) {
      [streetName, houseNumber] = streetName.split('+').map(s => s.trim());
    }

    return { streetName, houseNumber };
  }

  buildWhereCondition(query: { blockId: any }, streetName: any, houseNumber: any) {
    if (houseNumber) {
      return {
        blockId: query.blockId,
        number: { contains: String(houseNumber) },
        address: { name: { contains: streetName, mode: 'insensitive' } },
      };
    }

    return {
      blockId: query.blockId,
      address: { name: { contains: streetName, mode: 'insensitive' } },
    };
  }
}

type TerritoryEditQuery = {
  blockId: number;
  territoryId: number;
  streetFilter?: string;
};

type HouseOutput = {
  id: number;
  order: number | null;
  number: string;
  legend: string | null;
  dontVisit: boolean;
  observations: string | null;
  street: string;
};

type TerritoryEditOutput = {
  name: string;
  typeName: string;
  imageUrl: string | null;
  totalHouse: number;
  house: HouseOutput[];
  historyOverseer: {
    overseer: string;
    initialDate: Date;
    expirationDate: Date | null;
    finished: boolean;
    roundNumber: number;
  }[];
  pagination: {
    totalHouses: number;
    totalPages: number;
    currentPage: number;
    pageSize: number;
  };
};
