import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { API_BASE_PATH } from '@medikiosk/api-contracts';
import { AppModule } from './app.module';
import { assertProductionAdapters, loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  assertProductionAdapters(env);

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet());
  app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''), {
    exclude: ['health', 'health/ready'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  const openApi = new DocumentBuilder()
    .setTitle('MediKiosk Core API')
    .setDescription('Patient intake, consent, pre-check-in, QR validation and HIS token requests.')
    .setVersion('1.0.0-alpha.1')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openApi));

  await app.listen(env.PORT);
  Logger.log(`core_api listening on :${env.PORT} (HIS adapter: ${env.HIS_ADAPTER})`, 'Bootstrap');
}

void bootstrap();
