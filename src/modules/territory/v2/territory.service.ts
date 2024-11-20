import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma.service';
import { BaseService } from 'src/shared/BaseService';
import { FindAllParams } from '../contracts/find-all';
import { FirebaseService } from 'src/infra/firebase.service';

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
        where: { tenantId },
        include: { type: true },
        skip,
        take,
        orderBy,
      }),
      this.prisma.territory.count({
        where: { tenantId },
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
    const tenantName = tenant?.name.toLowerCase().replace(/ /g, '-');
    const fileType = file.mimetype.split('/')[1];
    const fileUrl = await this.firebaseService.uploadFile(file, `mapas/${tenantName}/${id}.${fileType}`);
    this.logger.log(`Atualizando território ${id} com a URL da imagem`);
    await this.prisma.territory.update({
      where: { id },
      data: { imageUrl: fileUrl as string },
    });

    return this.prisma.territory.findUnique({
      where: { id },
    });
  }
}
