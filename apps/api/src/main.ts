import 'reflect-metadata';
import './sentry'; // ← MUST be before NestFactory; no-op when SENTRY_DSN_API unset
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded, type Request } from 'express';
import { env } from '@orca/config';
import { AppModule } from './app.module';

async function bootstrap() {
  process.env.ORCA_SERVICE_NAME = 'orca-api';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    bodyParser: false,
  });

  // Capture raw body for HMAC-signed webhooks (CoinPayments IPN).
  const rawBodyVerify = (req: Request & { rawBody?: Buffer }, _res: unknown, buf: Buffer) => {
    if (Buffer.isBuffer(buf) && buf.length) req.rawBody = Buffer.from(buf);
  };
  app.use(json({ verify: rawBodyVerify, limit: '1mb' }));
  app.use(urlencoded({ verify: rawBodyVerify, extended: true, limit: '1mb' }));

  app.setGlobalPrefix(env.API_PREFIX);
  app.enableCors({
    origin: env.API_CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });
  // Note: we use ZodValidationPipe per-route instead of a global ValidationPipe
  // because all DTOs are Zod schemas (not class-validator decorators).
  app.set('trust proxy', 1);

  const port = env.API_PORT;
  await app.listen(port, env.API_HOST);
  const logger = new Logger('Bootstrap');
  logger.log(`🐋 Orca API listening on http://${env.API_HOST}:${port}/${env.API_PREFIX}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
