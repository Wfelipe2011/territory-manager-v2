import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, VersioningType } from '@nestjs/common';
import fs from 'fs';
import { uuid } from './shared';
process.env.INSTANCE_ID = `pod-${uuid()}`;
process.env.TZ = 'America/Sao_Paulo';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  logger.debug('Iniciando a aplicação...');
  const { version, description, title } = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.enableVersioning({
    type: VersioningType.URI,
  });
  logger.debug('Configurando a documentação da API...');
  const config = new DocumentBuilder()
    .setTitle(title)
    .setDescription('Bem-vindo à API do Territory Manager!')
    .setDescription(description)
    .setVersion(version)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT!, () => {
    logger.debug(`Aplicação iniciada na porta ${process.env.PORT}`);
  });
}
bootstrap();
