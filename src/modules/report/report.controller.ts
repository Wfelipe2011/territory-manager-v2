import { Body, Controller, Get, Logger, Param, ParseIntPipe, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { VERSION } from 'src/enum/version.enum';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { Role } from 'src/enum/role.enum';
import { Roles } from 'src/decorators/roles.decorator';
import { Prisma } from '@prisma/client';
import { CreateReportDto } from './contracts/CreateReport';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { UserToken } from '../auth/contracts';

@Controller({
  version: VERSION.V1,
  path: 'reports',
})
export class ReportController {
  logger = new Logger(ReportController.name);
  constructor(private prismaService: PrismaService) { }

  @Get()
  @Roles(Role.ADMIN)
  async getReports(@CurrentUser() user: UserToken) {
    return this.prismaService.house.findMany({
      where: {
        reportType: {
          not: null,
        },
        tenantId: user.tenantId,
      },
      include: {
        territory: {
          select: {
            name: true,
          },
        },
        address: {
          select: {
            name: true,
          },
        },
        block: {
          select: {
            name: true,
          },
        },
        multitenancy: {
          select: {
            name: true,
          },
        },
      },
    });
  }

  @Post()
  @Roles(Role.ADMIN, Role.DIRIGENTE, Role.PUBLICADOR)
  @UsePipes(new ValidationPipe({ transform: true }))
  async createReport(@CurrentUser() user: UserToken, @Body() body: CreateReportDto) {
    console.log('createReport', body);
    return this.prismaService.$transaction(async tsx => {
      let backupHouse = null;
      if (body?.id) {
        backupHouse = (await tsx.house.findFirst({
          where: {
            id: body.id,
          },
        })) as Prisma.JsonObject;
      }

      const house = await tsx.house.upsert({
        where: { id: body.id ?? 0 },
        create: {
          ...body,
          tenantId: user.tenantId,
        },
        update: {
          ...body,
          backupData: backupHouse!,
        },
      });

      if (!body?.id) {
        const rounds = await tsx.round.findMany({
          select: {
            roundNumber: true,
          },
          where: {
            tenantId: user.tenantId,
            endDate: null,
          },
          distinct: ['roundNumber'],
        });
        for (const round of rounds) {
          await tsx.round.create({
            data: {
              completed: false,
              roundNumber: round.roundNumber,
              blockId: house.blockId,
              territoryId: house.territoryId,
              houseId: house.id,
              tenantId: house.tenantId,
            },
          });
        }
      }
      return house;
    });
  }

  @Post('approve/:id')
  @Roles(Role.ADMIN)
  async approveReport(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserToken) {
    this.logger.log(`Iniciando aprovação do report ${id}`);
    return this.prismaService.$transaction(async txt => {
      this.logger.log(`Buscando report ${id}`);
      const house = await txt.house.findUnique({ where: { id, tenantId: user.tenantId } });
      if (!house) {
        this.logger.error(`Report ${id} não encontrado`);
        throw new Error('Registro não encontrado');
      }
      this.logger.log(`Report ${id} encontrado. reportType: ${house.reportType}`);

      if (house.reportType === 'remove') {
        this.logger.log(`Deletando registros relacionados ao report ${id}`);
        await txt.round.deleteMany({
          where: {
            houseId: id,
            tenantId: house.tenantId,
          },
        });
        this.logger.log(`Registros deletados com sucesso`);
        await txt.house.delete({
          where: {
            id,
            tenantId: house.tenantId,
          },
        });
        this.logger.log(`Report ${id} aprovado com sucesso e registros deletados`);
        return { message: 'Alteração aprovada com sucesso' };
      }

      await txt.house.update({
        where: { id, tenantId: house.tenantId, },
        data: {
          reportType: null,
          backupData: Prisma.JsonNull,
          observations: null,
        },
      });
      this.logger.log(`Report ${id} aprovado com sucesso e backup removido`);

      const filter = {
        number: 'ghost',
        tenantId: house.tenantId,
        territoryId: house.territoryId,
        OR: [] as any[]
      };

      if (house.territoryBlockAddressId) {
        filter.OR.push({ territoryBlockAddressId: house.territoryBlockAddressId });
      }

      if (house.blockId && house.addressId) {
        filter.OR.push({
          AND: [
            { blockId: house.blockId },
            { addressId: house.addressId }
          ]
        });
      }

      // buscar house ghost e remover
      const houseGhost = await txt.house.findFirst({
        where: filter
      })

      if (houseGhost) {
        await txt.round.deleteMany({
          where: {
            houseId: houseGhost.id,
          },
        });
        await txt.house.delete({
          where: {
            id: houseGhost.id,
          },
        });
        this.logger.log(`Casa fantasma removida com sucesso`);
      }
      return { message: 'Alteração aprovada com sucesso' };
    });
  }

  @Post('cancel/:id')
  @Roles(Role.ADMIN)
  async cancelReport(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UserToken) {
    return this.prismaService.$transaction(async tsx => {
      this.logger.log(`Iniciando cancelamento do report ${id}`);
      const house = await tsx.house.findUnique({
        where: { id, tenantId: user.tenantId },
      });
      if (!house) {
        this.logger.error(`Report ${id} não encontrado`);
        throw new Error('Registro ou backup não encontrado');
      }

      this.logger.log(`Report ${id} encontrado`);
      this.logger.log(`Tipo de report: ${house.reportType}`);
      if (house.reportType === 'add') {
        this.logger.log(`Removendo registros relacionados ao report ${id}`);
        await tsx.round.deleteMany({
          where: {
            houseId: id,
          },
        });
        this.logger.log(`Registros deletados com sucesso`);
        await tsx.house.delete({
          where: {
            id,
          },
        });
        this.logger.log(`Backup restaurado e registros deletados com sucesso`);
        return { message: 'Alteração cancelada e registros deletados com sucesso' };
      }

      this.logger.log(`Restaurando backup do report ${id}`);
      const backupData = house.backupData as Prisma.JsonObject;
      this.logger.debug(`Backup: ${JSON.stringify(backupData, null, 2)}`);
      this.logger.debug(`Report: ${JSON.stringify(house, null, 2)}`);
      await tsx.house.update({
        where: { id },
        data: {
          ...backupData,
          backupData: Prisma.JsonNull,
          reportType: null,
          observations: null,
        },
      });
      this.logger.log(`Backup restaurado com sucesso`);

      return { message: 'Alteração cancelada e backup restaurado com sucesso' };
    });
  }
}
