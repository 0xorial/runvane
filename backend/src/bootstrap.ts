import { Logger } from 'nestjs-pino';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module.js';
import { HttpExceptionLoggingFilter } from './http/http-exception-logging.filter.js';
import type { StubLlmControl } from './llmProviders/providers/stubLlm.control.js';
import { STUB_DEMO_MODELS } from './llmProviders/providers/stubLlm.models.js';
import { StubLlmProvider } from './llmProviders/providers/stubLlm.js';
import type { RunvaneRuntimeConfig } from './runtime/runtime.config.js';

export type RunvaneBootConfig = RunvaneRuntimeConfig & {
  port: number;
  frontendOrigin: string;
  databaseUrl: string;
};

export type RunvaneAppHandle = {
  app: INestApplication;
  origin: string;
  /** Present when `llm.mode === 'stub'` — configure via `setNextResponse` / `reset`. */
  stubLlm: StubLlmControl | null;
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
  const nodeEnv: RunvaneRuntimeConfig['nodeEnv'] =
    process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
      ? process.env.NODE_ENV
      : 'production';
  const llm: RunvaneRuntimeConfig['llm'] = (() => {
    if (process.env.LLM_TEST_STUB === '1' || process.env.LLM_DEMO === '1') {
      const demo = process.env.LLM_DEMO === '1';
      const streamDelayMs = process.env.LLM_DEMO_DELAY_MS
        ? Number(process.env.LLM_DEMO_DELAY_MS)
        : demo
          ? 20
          : undefined;
      return {
        mode: 'stub',
        streamDelayMs,
        models: demo ? STUB_DEMO_MODELS : undefined,
      };
    }
    return { mode: 'live' };
  })();
  return {
    llm,
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

  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bufferLogs: true,
    bodyParser: false,
  });
  // Editing a thought's context (the edit-the-prompt flow) can post a request
  // body larger than Express's 100kb default; raise it so those don't 413.
  app.useBodyParser('json', { limit: '16mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '16mb' });
  app.useLogger(app.get(Logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({
    origin: corsOriginsFor(config.frontendOrigin),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionLoggingFilter());
  await app.listen(config.port);

  const origin = `http://127.0.0.1:${config.port}`;
  const stubLlm = config.llm.mode === 'stub' ? app.get(StubLlmProvider) : null;
  return {
    app,
    origin,
    stubLlm,
    async close() {
      await app.close();
    },
  };
}
