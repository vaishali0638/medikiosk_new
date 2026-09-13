import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { API_BASE_PATH } from '@medikiosk/api-contracts';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { assertProductionAdapters, loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  assertProductionAdapters(env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet());
  // Document uploads arrive as base64 in a JSON body. The limit is set above the
  // 15 MB file cap plus encoding overhead, so an oversized file is refused by the
  // document validator with a reason a patient can act on, not by the parser with a 413.
  app.useBodyParser('json', { limit: '24mb' });
  app.setGlobalPrefix(API_BASE_PATH.replace(/^\//, ''), {
    exclude: ['health', 'health/ready'],
  });
  // Every failure leaves through one filter, so no stack trace, SQL text or constraint
  // name can reach a kiosk screen standing in a public corridor.
  app.useGlobalFilters(new DomainExceptionFilter());

  // No class-validator pipe: the Zod schemas in @medikiosk/api-contracts are the single
  // source of truth for request shape, and a second validation mechanism would let the
  // published contract and the accepted payload drift apart.

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
