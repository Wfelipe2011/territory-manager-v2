import { Controller, Get, Logger, Param, ParseIntPipe, Post, Query, UploadedFile, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { VERSION } from 'src/enum/version.enum';
import { TerritoryServiceV2 } from './territory.service';
import { UserToken } from 'src/modules/auth/contracts';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { FindAllParams } from '../contracts/find-all';
import { FileInterceptor } from '@nestjs/platform-express';
import { FirebaseService } from 'src/infra/firebase.service';

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
}
