import { PrismaService } from '../../infra/prisma/prisma.service';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BlockSignatureDTO } from './dtos/BlockSignatureDTO';
import { BlockSignature } from './dtos/BlockSignature';
import { RawHouse } from './dtos/RawHouse';
import { Output, Round } from './dtos/Houses';
import { LegengDTO } from './dtos/Legend';
import dayjs from 'dayjs';
import { UpdateHouseOrder } from './contracts/UpdateHouseOrder';
import { ParametersService } from '../parameters/parameters.service';
import { AddressBlockService } from '../block/adress-block.service';

export type CreateHouseInput = {
  streetId: number;
  number: string;
  legend: string;
  dontVisit: boolean;
  territoryId: number;
  blockId: number;
};

@Injectable()
export class HouseService {
  private logger = new Logger(HouseService.name);
  constructor(
    readonly prisma: PrismaService,
    private readonly parametersService: ParametersService,
    private readonly addressBlockService: AddressBlockService
  ) { }

  async getAddressPerTerritoryByIdAndBlockById(blockId: number, territoryId: number) {
    const territoryBlock = await this.prisma.territory_block.findUnique({
      where: {
        territoryId_blockId: {
          blockId,
          territoryId,
        },
      },
      include: { signature: true, territory: true, block: true },
    });
    this.logger.log(`Buscando as ruas do território: [${territoryBlock?.territory.name}-${territoryBlock?.block.name}]`);

    if (territoryBlock) {
      await this.addressBlockService.syncGhostHouses(territoryId, blockId, territoryBlock.tenantId).catch(err => {
        this.logger.error(`Erro ao sincronizar casas fantasmas para o território: [${territoryBlock?.territory.name}-${territoryBlock?.block.name}]`);
        this.logger.error(err);
      });
    }

    this.logger.log(`Verificando se [${territoryBlock?.territory.name}-${territoryBlock?.block.name}] tem assinatura`);
    if (!territoryBlock?.signatureId) throw new NotFoundException('Quadra não tem assinatura');
    this.logger.log(`[${territoryBlock?.territory.name}-${territoryBlock?.block.name}] tem assinatura`);

    const result = await this.getBlockDetails(blockId, territoryId);
    if (!result) throw new NotFoundException('Não foi possível encontrar os dados da quadra');
    const data = BlockSignatureDTO.mapper(result);
    return data;
  }

  async getHousesPerTerritoryByIdAndBlockByIdAndAddressById(blockId: number, territoryId: number, streetId: number, round: number) {
    const houses = await this.prisma.$queryRaw<RawHouse[]>`
        SELECT
          h.id as house_id,
          h."number",
          h.complement,
          h.legend,
          h."order",
          h.dont_visit,
          h.report_type,
          round.completed as status,
          round.leave_letter,
          a."name" as street_name,
          b."name" as block_name,
          t."name" as territory_name
        FROM house h
        INNER JOIN round ON round.house_id = h.id AND round.round_number = ${round}
        INNER JOIN address a ON a.id = h.address_id
        INNER JOIN block b ON b.id = h.block_id
        INNER JOIN territory t ON t.id = h.territory_id
        WHERE h.address_id = ${streetId}
          AND h.block_id = ${blockId}
          AND h.territory_id = ${territoryId}
        ORDER BY h."order" ASC;
      `;

    if (!houses.length) throw new NotFoundException('Não foi possível encontrar as casas da rua');

    const { territory_name, block_name, street_name } = houses[0];
    const output: Output = {
      territoryName: territory_name,
      blockName: block_name,
      streetName: street_name,
      houses: houses.filter(h => h.number !== "ghost").map(house => ({
        id: house.house_id,
        number: house.number,
        complement: house.complement,
        leaveLetter: house.leave_letter,
        legend: LegengDTO.mapper(house?.legend),
        order: house.order,
        status: house.status,
        dontVisit: house.dont_visit,
        reportType: house.report_type,
      })),
    };

    return output;
  }

  async updateHouse(houseId: number, body: { status: boolean }, isAdmin: boolean, roundNumber: number) {
    const [[round], house] = await Promise.all([
      this.prisma.$queryRaw<Round[]>`SELECT * FROM round WHERE house_id = ${houseId} AND round_number = ${roundNumber}`,
      this.prisma.house.findUnique({ where: { id: houseId }, include: { territory: true, block: true } }),
    ]);
    if (!round) throw new BadRequestException('Casa não encontrada');
    if (!house) throw new NotFoundException('Casa não encontrada');
    this.logger.log(`Verificando se a casa [${house?.territory.name}-${house?.block.name}-${house?.number}] pode ser atualizada`);

    if (!isAdmin && round.completed_date && body.status === false) {
      const now = dayjs();
      const updateDate = dayjs(round.completed_date);
      const customHours = await this.parametersService.getValue(house.tenantId, 'SIGNATURE_EXPIRATION_HOURS');
      const hours = customHours ? parseInt(customHours) : 5;
      if (now.diff(updateDate, 'hours') > hours)
        throw new ForbiddenException(`Casa [${house?.territory.name}-${house?.block.name}-${house?.number}] não pode ser atualizada`);
    }

    await this.prisma.$queryRaw`
      UPDATE round SET 
        update_date = ${new Date()}, 
        completed = ${body.status}, 
        completed_date = ${new Date()} 
      WHERE house_id = ${houseId} AND round_number = ${roundNumber}`;

    this.logger.log(`Casa [${house?.territory.name}-${house?.block.name}-${house?.number}] atualizada com sucesso`);

    return { message: 'Casa atualizada com sucesso' };
  }

  private async getBlockDetails(blockId: number, territoryId: number): Promise<BlockSignature[]> {
    return this.prisma.$queryRaw<BlockSignature[]>`
      SELECT 
        b."name" as block_name,
        b.id as block_id,
        a.id as address_id,
        a."name" as address_name,
        h."number" as house_number,
        t."name" as territory_name,
        t.image_url,
        t.id as territory_id 
      FROM house h 
      INNER JOIN territory t ON t.id = h.territory_id 
      INNER JOIN address a ON a.id = h.address_id 
      INNER JOIN block b ON b.id = h.block_id
      LEFT JOIN territory_overseer to2 on to2.territory_id = t.id  and to2.finished = false 
      WHERE h.territory_id = ${territoryId} AND h.block_id = ${blockId} 
    `;
  }

  async findById(id: number) {
    return this.prisma.house.findFirst({
      where: {
        id,
      },
      include: {
        address: true,
        territory: true,
        block: true,
      },
    });
  }

  async create(input: CreateHouseInput) {
    this.logger.log(`Criando casa na rua ${input.streetId} e bloco ${input.blockId} e território ${input.territoryId}`);
    const { streetId, number, legend, dontVisit, territoryId, blockId } = input;
    const address = await this.prisma.address.findUnique({ where: { id: +streetId } });
    if (!address) throw new NotFoundException('Rua não encontrada');
    const block = await this.prisma.block.findUnique({ where: { id: +blockId } });
    if (!block) throw new NotFoundException('Bloco não encontrado');
    const territory = await this.prisma.territory.findUnique({ where: { id: +territoryId } });
    if (!territory) throw new NotFoundException('Território não encontrado');

    this.logger.log(`Verificando se a casa ${number} já existe`);

    const house = await this.prisma.house.create({
      data: {
        number,
        legend,
        dontVisit,
        address: {
          connect: {
            id: +streetId,
          },
        },
        block: {
          connect: {
            id: +blockId,
          },
        },
        territory: {
          connect: {
            id: +territoryId,
          },
        },
        multitenancy: {
          connect: {
            id: territory.tenantId,
          },
        },
      },
    });

    this.logger.log(`Casa ${number} criada com sucesso`);

    this.logger.log(`Criando rodadas para a casa ${number}`);

    this.logger.log(`Buscando as rodadas do território ${territoryId} e bloco ${blockId} e endereço ${streetId} e casa ${house.id}`);
    const roundNumber = await this.prisma.$queryRaw<{ round_number: number }[]>`
    SELECT round.round_number  FROM round
    WHERE round.tenant_id = ${territory.tenantId}
    GROUP BY round.round_number
    `;

    this.logger.log(`Criando rodadas para a casa ${number}`);

    for (const round of roundNumber) {
      this.logger.log(`Criando rodada ${round.round_number} para a casa ${number}`);
      await this.prisma.round.create({
        data: {
          completed: false,
          roundNumber: round.round_number,
          blockId: +blockId,
          tenantId: territory.tenantId,
          houseId: house.id,
          territoryId: +territoryId,
        },
      });
    }

    this.logger.log(`Rodadas criadas com sucesso para a casa ${number}`);

    return house;
  }

  async update(id: number, input: CreateHouseInput) {
    const house = await this.prisma.house.findUnique({ where: { id } });
    if (!house) throw new NotFoundException('Casa não encontrada');
    const { streetId, number, legend, dontVisit, territoryId, blockId } = input;
    const address = await this.prisma.address.findUnique({ where: { id: +streetId } });
    if (!address) throw new NotFoundException('Rua não encontrada');
    const block = await this.prisma.block.findUnique({ where: { id: +blockId } });
    if (!block) throw new NotFoundException('Bloco não encontrado');
    const territory = await this.prisma.territory.findUnique({ where: { id: +territoryId } });
    if (!territory) throw new NotFoundException('Território não encontrado');

    return this.prisma.house.update({
      where: {
        id,
      },
      data: {
        number,
        legend,
        dontVisit,
        address: {
          connect: {
            id: +streetId,
          },
        },
        block: {
          connect: {
            id: +blockId,
          },
        },
        territory: {
          connect: {
            id: +territoryId,
          },
        },
        multitenancy: {
          connect: {
            id: territory.tenantId,
          },
        },
      },
    });
  }

  async delete(id: number) {
    const house = await this.prisma.house.findUnique({ where: { id } });
    if (!house) throw new NotFoundException('Casa não encontrada');
    this.logger.log(`Deletando rodadas da casa ${id}`);
    await this.prisma.round.deleteMany({ where: { houseId: id } });
    this.logger.log(`Rodadas deletadas com sucesso da casa ${id}`);
    await this.prisma.house.delete({ where: { id } });
    this.logger.log(`Casa ${id} deletada com sucesso`);
  }

  async updateOrder(inputs: UpdateHouseOrder): Promise<void> {
    this.logger.log(`Atualizando ordem das casas`);
    await this.prisma.$transaction(inputs.houses.map(house => {
      this.logger.log(`Atualizando casa ${house.id} para a ordem ${house.order}`);
      return this.prisma.house.update({
        where: {
          id: house.id,
        },
        data: {
          order: house.order,
        },
      });
    }));
    this.logger.log(`Ordem das casas atualizada com sucesso`);
  }
}
