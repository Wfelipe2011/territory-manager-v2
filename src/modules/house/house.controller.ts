import { EventsGateway } from './../gateway/event.gateway';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Logger, Param, Patch, Post, Put, Query, Request, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { HouseService } from './house.service';
import { AddressPerTerritoryAndBlockOutput } from './contracts/AddressPerTerritoryAndBlockOutput';
import { VERSION } from 'src/enum/version.enum';
import { SignatureIsValid } from '../signature/usecase/SignatureIsValid';
import { RequestSignature, RequestUser } from 'src/interfaces/RequestUser';
import { RoundParams } from '../territory/contracts';
import { UpdateHouseOrder } from './contracts/UpdateHouseOrder';
import { UpsertHouseInput } from './contracts/UpsertHouseInput';

@ApiBearerAuth()
@ApiTags('House')
@Controller({
  version: VERSION.V1,
})
export class HouseController {
  logger = new Logger(HouseController.name);
  private signatureIsValid: SignatureIsValid;

  constructor(
    private houseService: HouseService,
    private eventsGateway: EventsGateway
  ) {
    this.signatureIsValid = new SignatureIsValid(houseService.prisma);
  }

  @Roles(Role.ADMIN, Role.DIRIGENTE, Role.PUBLICADOR)
  @ApiOperation({ summary: 'Obter as ruas em um território por quadra' })
  @ApiResponse({ status: 200, type: AddressPerTerritoryAndBlockOutput })
  @Get('/territories/:territoryId/blocks/:blockId')
  async getAddressPerTerritoryByIdAndBlockById(
    @Param('territoryId') territoryId: number,
    @Param('blockId') blockId: number,
    @Query() query: RoundParams,
    @Request() req: RequestSignature
  ): Promise<AddressPerTerritoryAndBlockOutput> {
    try {
      this.logger.log(`Usuário ${JSON.stringify(req.user, null, 2)} está buscando os endereços do território ${territoryId} e bloco ${blockId}`);
      if (!territoryId) throw new BadRequestException('Território são obrigatório');
      if (!blockId) throw new BadRequestException('Bloco são obrigatório');
      if (isNaN(+territoryId)) throw new BadRequestException('Território inválido');
      if (isNaN(+blockId)) throw new BadRequestException('Bloco inválido');
      if (!query.round && isNaN(+query.round)) throw new BadRequestException('Rodada inválida');
      if (req.user.roles.includes(Role.PUBLICADOR)) {
        await this.signatureIsValid.execute(req.user.id);
        if (req.user.territoryId !== +territoryId || req.user.blockId !== +blockId) {
          throw new ForbiddenException(`Você ${req.user.id} não tem permissão para acessar esse território`);
        }
      }
      const result = await this.houseService.getAddressPerTerritoryByIdAndBlockById(+blockId, +territoryId);
      return result;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Roles(Role.ADMIN, Role.DIRIGENTE, Role.PUBLICADOR)
  @Get('/territories/:territoryId/blocks/:blockId/address/:addressId')
  async getHousesPerTerritoryByIdAndBlockByIdAndAddressById(
    @Param('territoryId') territoryId: number,
    @Param('blockId') blockId: number,
    @Param('addressId') addressId: number,
    @Query() query: RoundParams,
    @Request() req: RequestSignature
  ) {
    try {
      this.logger.log(
        `Usuário ${JSON.stringify(req.user, null, 2)} está buscando os endereços do território ${territoryId} e bloco ${blockId} e endereço ${addressId}`
      );
      if (!territoryId) throw new BadRequestException('Território são obrigatório');
      if (!blockId) throw new BadRequestException('Bloco são obrigatório');
      if (!addressId) throw new BadRequestException('Endereço são obrigatório');
      if (isNaN(+territoryId)) throw new BadRequestException('Território inválido');
      if (isNaN(+blockId)) throw new BadRequestException('Bloco inválido');
      if (isNaN(+addressId)) throw new BadRequestException('Endereço inválido');
      if (!query.round && isNaN(+query.round)) throw new BadRequestException('Rodada inválida');

      if (req.user.roles.includes(Role.PUBLICADOR)) await this.signatureIsValid.execute(req.user.id);

      const result = await this.houseService.getHousesPerTerritoryByIdAndBlockByIdAndAddressById(+blockId, +territoryId, +addressId, +query.round);
      return result;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Roles(Role.ADMIN, Role.DIRIGENTE, Role.PUBLICADOR)
  @Patch('/territories/:territoryId/blocks/:blockId/address/:addressId/houses/:houseId')
  async updateHouse(
    @Param('houseId') houseId: number,
    @Param('territoryId') territoryId: number,
    @Param('blockId') blockId: number,
    @Param('addressId') addressId: number,
    @Body() body: { status: boolean; round: number },
    @Request() req: RequestSignature
  ) {
    try {
      this.logger.log(
        `Usuário ${JSON.stringify(
          req.user,
          null,
          2
        )} está buscando os endereços do território ${territoryId} e bloco ${blockId} e endereço ${addressId} e casa ${houseId}`
      );
      if (!houseId) throw new BadRequestException('Casa são obrigatório');
      if (!territoryId) throw new BadRequestException('Território são obrigatório');
      if (!blockId) throw new BadRequestException('Bloco são obrigatório');
      if (!addressId) throw new BadRequestException('Endereço são obrigatório');
      if (isNaN(+houseId)) throw new BadRequestException('Casa inválido');
      if (!body.status === undefined) throw new BadRequestException('Status são obrigatório');
      if (req.user.roles.includes(Role.PUBLICADOR)) await this.signatureIsValid.execute(req.user.id);
      if (!body.round && isNaN(+body.round)) throw new BadRequestException('Rodada inválida');
      const isAdmin = req.user.roles.includes(Role.ADMIN);

      const result = await this.houseService.updateHouse(+houseId, body, isAdmin, +body.round);
      this.eventsGateway.emitRoom(`${territoryId}-${blockId}-${addressId}-${body.round}`, {
        type: 'update_house',
        data: {
          houseId: houseId,
          completed: body.status,
        },
      });
      return result;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Roles(Role.ADMIN)
  @Get('houses/:id')
  async findById(@Param('id') id: number) {
    try {
      const result = await this.houseService.findById(+id);
      return result;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Roles(Role.ADMIN)
  @Put('houses/:id')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async update(@Param('id') id: number, @Body() body: UpsertHouseInput) {
    try {
      return await this.houseService.update(+id, body);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Roles(Role.ADMIN)
  @Post('houses')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async create(@Body() body: UpsertHouseInput) {
    try {
      return this.houseService.create(body);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Roles(Role.ADMIN)
  @Delete('houses/:id')
  async delete(@Param('id') id: number) {
    try {
      const result = await this.houseService.delete(+id);
      return result;
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @Roles(Role.ADMIN)
  @Post('houses/order')
  @ApiOperation({ summary: 'Atualiza a ordem das casas' })
  @ApiResponse({ status: 200, description: 'Ordem atualizada com sucesso' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async updateOrder(@Body() body: UpdateHouseOrder): Promise<void> {
    try {
      return await this.houseService.updateOrder(body);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }
}
