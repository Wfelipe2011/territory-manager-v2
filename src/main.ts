import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { prisma } from './infra/prisma';
import { VersioningType } from '@nestjs/common';
import fs from 'fs';
import { uuid } from './shared';
import { WinstonModule } from 'nest-winston';
import { logger } from './infra/logger';
process.env.INSTANCE_ID = `pod-${uuid()}`;
process.env.TZ = 'America/Sao_Paulo';

async function bootstrap() {
  const { version, description, title } = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger(logger),
  });
  app.enableCors();
  app.enableVersioning({
    type: VersioningType.URI,
  });

  const config = new DocumentBuilder()
    .setTitle(title)
    .setDescription('Bem-vindo à API do Territory Manager!')
    .setDescription(description)
    .setVersion(version)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document);
  console.log(process.env);

  await app.listen(process.env.PORT!);
}
bootstrap();
