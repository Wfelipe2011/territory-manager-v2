import { PrismaService } from './infra/prisma/prisma.service';
import { Controller, ForbiddenException, Get, Logger, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './decorators/public.decorator';
import { VERSION } from './enum/version.enum';
import { FileInterceptor } from '@nestjs/platform-express';
import { FirebaseUploadService } from './firebase-upload.service';
import { HealthService } from './modules/dashboard/health.service';

@ApiTags('Verificação de Saúde')
@Controller({
  version: VERSION.V1,
})
export class AppController {
  logger = new Logger(AppController.name);
  constructor(
    private prismaService: PrismaService,
    private firebaseUploadService: FirebaseUploadService,
    private healthService: HealthService,
  ) { }

  @Public()
  @ApiOperation({ summary: 'Verificação de saúde do servidor' })
  @ApiOkResponse({ description: 'Servidor está em execução', type: String })
  @Get('/health-check')
  async healthCheck() {
    return this.healthService.getHealthData();
  }

  @Public()
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
  async uploadFile(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    this.logger.log(`Iniciando upload para o ID: ${id}`);
    try {
      const maps = {
        [process.env.ITA!]: 'ita/catalogo'
      }
      if (!maps[id]) {
        this.logger.warn(`Map não encontrado para o ID: ${id}`);
        throw new ForbiddenException(`Map não encontrado para o ID: ${id}`);
      }
      this.logger.log(`Fazendo upload do arquivo: ${file.originalname} para o caminho: ${maps[id]}`);
      const result = await this.firebaseUploadService.uploadFile(maps[id], file);
      this.logger.log(`Upload concluído com sucesso para o ID: ${id}.`);
      return result;
    } catch (error) {
      this.logger.error(`Falha no upload para o ID: ${id}`, error.stack);
      throw error;
    }
  }
}
