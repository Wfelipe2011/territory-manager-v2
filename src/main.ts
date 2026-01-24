import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, VersioningType } from '@nestjs/common';
import fs from 'fs';
import { uuid } from './shared';
import hbs from 'hbs';
process.env.INSTANCE_ID = `pod-${uuid()}`;
process.env.TZ = 'America/Sao_Paulo';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  logger.debug('Iniciando a aplicação...');
  const { version, description, title } = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.enableVersioning({
    type: VersioningType.URI,
  });

  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('hbs');

  hbs.registerHelper('formatDate', (date: string) => {
    if (!date) return '';
    return new Date(date).toLocaleString('pt-BR');
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
