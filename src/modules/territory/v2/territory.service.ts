import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { BaseService } from 'src/shared/BaseService';
import { FindAllParams } from '../contracts/find-all';
import { FirebaseService } from 'src/infra/firebase.service';
import { FindOneParams } from '../contracts/find-one';
import { TerritoryEditOutput } from '../interfaces/TerritoryEditOutputV2';

@Injectable()
export class TerritoryServiceV2 extends BaseService {
  private readonly logger = new Logger(TerritoryServiceV2.name);
  constructor(
    readonly prisma: PrismaService,
    readonly firebaseService: FirebaseService
  ) {
    super();
  }

  async getTerritories(tenantId: number, params: FindAllParams) {
    this.logger.log('Buscando territorios...');
    const { page, limit, skip, take, orderBy } = this.getPaginationParams(params.page, params.limit, params.sort);

    const [data, total] = await Promise.all([
      this.prisma.territory.findMany({
        where: {
          tenantId,
          ...(params.search ? { name: { contains: params.search, mode: 'insensitive' } } : {}),
          ...(params.type ? { typeId: params.type } : {}),
        },
        include: { type: true },
        skip,
        take,
        orderBy,
      }),
      this.prisma.territory.count({
        where: {
          tenantId,
          ...(params.search ? { name: { contains: params.search, mode: 'insensitive' } } : {}),
          ...(params.type ? { typeId: params.type } : {}),
        },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async uploadFile(tenantId: number, id: number, file: Express.Multer.File) {
    const tenant = await this.prisma.multitenancy.findUnique({
      where: { id: tenantId },
    });
    const territory = await this.prisma.territory.findUnique({
      where: { id },
    });
    if (territory?.imageUrl) await this.firebaseService.deleteFileByUrl(territory?.imageUrl).catch(() => null);
    const tenantName = tenant?.name.toLowerCase().replace(/ /g, '-');
    const fileType = file.mimetype.split('/')[1];
    const fileUrl = await this.firebaseService.uploadFile(file, `mapas/${tenantName}/${Date.now()}.${fileType}`);
    this.logger.log(`Atualizando território ${id} com a URL da imagem`);
    await this.prisma.territory.update({
      where: { id },
      data: { imageUrl: fileUrl as string },
    });

    return this.prisma.territory.findUnique({
      where: { id },
    });
  }

  async findEditById(tenantId: number, territoryId: number, query: FindOneParams): Promise<TerritoryEditOutput> {
    const result = await this.prisma.territory.findFirst({
      where: { id: territoryId, tenantId },
      include: {
        territory_overseer: true,
        house: {
          where: {
            ...query.blockId ? { blockId: query.blockId } : {},
            number: { not: 'ghost' },
          },
          include: { address: true, block: true },
        },
        type: true,
      },
    });

    if (!result) throw new NotFoundException('Territorio não encontrado');

    return {
      name: result.name,
      typeName: result.type.name,
      imageUrl: result.imageUrl,
      totalHouse: result.house.length,
      house: result.house.map(h => ({
        id: h.id,
        dontVisit: h.dontVisit,
        legend: h.legend,
        number: h.number,
        street: h.address.name,
        streetId: h.addressId,
        observations: h.observations,
        order: h.order,
        blockName: h.block.name,
        blockId: h.blockId,
      })),
    };
  }
}

