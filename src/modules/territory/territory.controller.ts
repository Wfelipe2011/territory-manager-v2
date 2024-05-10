import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, Request, UnauthorizedException } from '@nestjs/common';
import { TerritoryService } from './territory.service';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from 'src/enum/role.enum';
import { Roles } from 'src/decorators/roles.decorator';
import { TerritoryOneOutput, TerritoryAllInput, TerritoryAllOutput, RoundParams, TerritoryTypesOutput } from './contracts';
import { VERSION } from 'src/enum/version.enum';
import { SignatureIsValid } from '../signature/usecase/SignatureIsValid';
import { logger } from 'src/infra/logger';
import { RequestSignature, RequestUser } from 'src/interfaces/RequestUser';

@ApiTags('Territórios')
@ApiBearerAuth()
@Controller({
  version: VERSION.V1,
  path: 'territories',
})
export class TerritoryController {
  private signatureIsValid: SignatureIsValid;
  constructor(readonly territoryService: TerritoryService) {
    this.signatureIsValid = new SignatureIsValid(territoryService.prisma);
  }

  @ApiResponse({ status: 200, type: TerritoryAllOutput, isArray: true })
  @ApiOperation({ summary: 'Busca todos os territórios' })
  @Get()
  @Roles(Role.ADMIN)
  async getTerritory(@Query() territoryDto: TerritoryAllInput, @Request() req: RequestUser): Promise<TerritoryAllOutput[]> {
    try {
      if (!territoryDto.round) throw new BadRequestException('Rodada é obrigatório');
      return await this.territoryService.findAll(territoryDto, req.user.tenantId);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiResponse({ status: 200, type: TerritoryTypesOutput, isArray: true })
  @ApiOperation({ summary: 'Busca todos os tipos de territórios' })
  @Get('types')
  @Roles(Role.ADMIN)
  async getTerritoryTypes(@Request() req: RequestUser): Promise<TerritoryTypesOutput[]> {
    try {
      logger.info(`Usuário ${JSON.stringify(req.user, null, 2)} está buscando os tipos de territórios`);
      return await this.territoryService.findTerritoryTypes(req.user.tenantId);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }
  // findBlockByTerritoryId

  @ApiResponse({ status: 200, type: TerritoryTypesOutput, isArray: true })
  @ApiOperation({ summary: 'Busca todos os tipos de territórios' })
  @Get(':territoryId/blocks')
  @Roles(Role.ADMIN)
  async getTerritoryBlocks(@Param('territoryId') territorySerialize: string): Promise<any[]> {
    try {
      if (!territorySerialize) throw new BadRequestException('Território são obrigatório');
      const id = Number(territorySerialize);
      if (isNaN(id)) throw new BadRequestException('Território inválido');
      return await this.territoryService.findBlockByTerritoryId(id);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiResponse({ status: 200, type: TerritoryOneOutput })
  @ApiOperation({ summary: 'Busca um território para edição' })
  @Get(':territoryId/edit')
  @Roles(Role.ADMIN)
  async getTerritoryEditById(
    @Param('territoryId') territorySerialize: string,
    @Query()
    query: {
      blockId: number;
      streetFilter?: string;
      page: number;
      pageSize: number;
    },
    @Request() req: RequestSignature
  ): Promise<any> {
    try {
      logger.info(`Usuário ${JSON.stringify(req.user, null, 2)} está buscando para edição o território ${territorySerialize}`);
      if (!territorySerialize) throw new BadRequestException('Território são obrigatório');
      if (!query.blockId) throw new BadRequestException('Quadra é obrigatório');
      if (!query.page) throw new BadRequestException('Página é obrigatório');
      if (!query.pageSize) throw new BadRequestException('Tamanho da página é obrigatório');

      const id = Number(territorySerialize);
      const blockNumber = Number(query.blockId);
      const { page, pageSize } = query;
      if (isNaN(id)) throw new BadRequestException('Território inválido');
      if (isNaN(blockNumber)) throw new BadRequestException('Quadra é inválido');
      if (isNaN(+page)) throw new BadRequestException('Página é inválido');
      if (isNaN(+pageSize)) throw new BadRequestException('Tamanho da página é inválido');

      return await this.territoryService.findEditById(
        {
          blockId: blockNumber,
          territoryId: id,
          streetFilter: query.streetFilter,
        },
        {
          page: +page,
          pageSize: +pageSize,
        }
      );
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  @ApiResponse({ status: 200, type: TerritoryOneOutput })
  @ApiOperation({ summary: 'Busca um território' })
  @Get(':territoryId')
  @Roles(Role.ADMIN, Role.DIRIGENTE)
  async getTerritoryById(
    @Param('territoryId') territorySerialize: string,
    @Query() query: RoundParams,
    @Request() req: RequestSignature
  ): Promise<TerritoryOneOutput> {
    try {
      logger.info(`Usuário ${JSON.stringify(req.user, null, 2)} está buscando o território ${territorySerialize}`);
      if (!territorySerialize) throw new BadRequestException('Território são obrigatório');
      const id = Number(territorySerialize);
      if (isNaN(id)) throw new BadRequestException('Território inválido');

      if (req.user.roles.includes(Role.DIRIGENTE)) {
        await this.signatureIsValid.execute(req.user.id);
        if (req.user.territoryId !== id) throw new ForbiddenException(`Você ${req.user.id} não tem permissão para acessar esse território`);
      }

      return await this.territoryService.findById(id, query.round);
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }
}

type TerritoryEditOutput = {
  name: string;
  houses: any;
};
