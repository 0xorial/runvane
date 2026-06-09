import { Logger } from 'nestjs-pino';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module.js';
import { HttpExceptionLoggingFilter } from './http/http-exception-logging.filter.js';
import type { RunvaneRuntimeConfig } from './runtime/runtime.config.js';

export type RunvaneBootConfig = RunvaneRuntimeConfig & {
  port: number;
  frontendOrigin: string;
  databaseUrl: string;
};

export type RunvaneAppHandle = {
  app: INestApplication;
  origin: string;
  close(): Promise<void>;
};

function corsOriginsFor(frontendOrigin: string): string[] {
  const parsed = new URL(frontendOrigin);
  if (!parsed.port) {
    throw new Error(`frontend origin must include a port: ${frontendOrigin}`);
  }
  return [`http://localhost:${parsed.port}`, `http://127.0.0.1:${parsed.port}`];
}

export function runtimeConfigFromEnv(): RunvaneBootConfig {
  const frontendOrigin = process.env.FRONTEND_ORIGIN;
  if (!frontendOrigin) {
    throw new Error('FRONTEND_ORIGIN is required (set via dev-ports/with-ports.mjs or .env.ports)');
  }
  const port = process.env.PORT;
  if (!port) {
    throw new Error('PORT is required (set via dev-ports/with-ports.mjs or .env.ports)');
  }
  const stub = process.env.LLM_TEST_STUB === '1';
  const nodeEnv: RunvaneRuntimeConfig['nodeEnv'] =
    process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
      ? process.env.NODE_ENV
      : 'production';
  return {
    llm: stub
      ? {
          mode: 'stub',
          demo: process.env.LLM_DEMO === '1',
          demoDelayMs: Number(process.env.LLM_DEMO_DELAY_MS ?? 45),
        }
      : { mode: 'live' },
    nodeEnv,
    port: Number(port),
    frontendOrigin,
    databaseUrl: process.env.DATABASE_URL ?? 'file:./backend.sqlite',
  };
}

export async function createRunvaneApp(config: RunvaneBootConfig): Promise<RunvaneAppHandle> {
  process.env.DATABASE_URL = config.databaseUrl;
  process.env.NODE_ENV = config.nodeEnv;
  process.env.PORT = String(config.port);
  process.env.FRONTEND_ORIGIN = config.frontendOrigin;

  const app = await NestFactory.create(AppModule.register(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({
    origin: corsOriginsFor(config.frontendOrigin),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionLoggingFilter());
  await app.listen(config.port);

  const origin = `http://127.0.0.1:${config.port}`;
  return {
    app,
    origin,
    async close() {
      await app.close();
    },
  };
}
