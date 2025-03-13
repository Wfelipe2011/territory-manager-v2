import { Controller, Get, Logger, Param, ParseIntPipe, Post, Query, UploadedFile, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { VERSION } from 'src/enum/version.enum';
import { UserToken } from 'src/modules/auth/contracts';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { FindAllParams } from '../contracts/find-all';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enum/role.enum';
import { FindOneParams } from '../contracts/find-one';
import { TerritoryEditOutput } from '../interfaces/TerritoryEditOutputV2';
import { TerritoryServiceV2 } from './territory.service';

@ApiBearerAuth()
@ApiTags('Territórios V2')
@Controller({
  version: VERSION.V2,
  path: 'territories',
})
@UsePipes(
  new ValidationPipe({
    transform: true, // Converte os parâmetros da requisição para os tipos especificados
    whitelist: true, // Remove propriedades que não estão definidas no DTO
  })
)
export class TerritoryControllerV2 {
  logger = new Logger(TerritoryControllerV2.name);
  constructor(readonly service: TerritoryServiceV2) { }

  @Get()
  getTerritories(@CurrentUser() user: UserToken, @Query() query: FindAllParams) {
    this.logger.log(`Usuário: ${user.userId} - Obtendo territórios...`);
    return this.service.getTerritories(user.tenantId, query);
  }

  @Post(':id/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(new Error('Somente imagens são permitidas'), false);
        }
        callback(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // Limita o tamanho da imagem para 5MB
    })
  )
  async uploadFile(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: UserToken) {
    return this.service.uploadFile(user.tenantId, id, file);
  }

  @ApiResponse({ status: 200, type: TerritoryEditOutput })
  @ApiOperation({ summary: 'Busca um território para edição' })
  @Get(':territoryId/edit')
  @Roles(Role.ADMIN)
  async getTerritoryEditById(
    @Param('territoryId', ParseIntPipe) territorySerialize: number,
    @Query()
    query: FindOneParams,
    @CurrentUser() user: UserToken
  ): Promise<TerritoryEditOutput> {
    try {
      this.logger.log(`Usuário ${JSON.stringify(user, null, 2)} está buscando para edição o território ${territorySerialize}`);

      return await this.service.findEditById(
        user.tenantId,
        territorySerialize,
        query
      );
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }
}
