import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, VersioningType } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import fs from 'fs';
import { uuid } from './shared';
import hbs from 'hbs';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './middleware/all-exceptions.filter';
process.env.INSTANCE_ID = `pod-${uuid()}`;
process.env.TZ = 'America/Sao_Paulo';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  logger.debug('Iniciando a aplicação...');
  const { version, description, title } = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();
  app.enableVersioning({
    type: VersioningType.URI,
  });

  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('hbs');
  hbs.registerPartials(join(__dirname, '..', 'views', 'partials'));

  hbs.registerHelper('formatDate', (date: string) => {
    if (!date) return '';
    return new Date(date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  });

  hbs.registerHelper('eq', function (a: any, b: any) {
    return a === b;
  });

  hbs.registerHelper('formatCurrency', (value: number) => {
    if (value === undefined || value === null) return '0,00';
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
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
