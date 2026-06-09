import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from '../../src/app.module.js';
import { HttpExceptionLoggingFilter } from '../../src/http/http-exception-logging.filter.js';
import type { LlmRuntime } from '../../src/runtime/runtime.config.js';

export type TestApp = {
  app: INestApplication;
  baseUrl: string;
};

function integrationLlm(): LlmRuntime {
  return process.env.INTEGRATION_LIVE_LLM === '1' ? { mode: 'live' } : { mode: 'stub' };
}

export async function createTestApp(): Promise<TestApp> {
  process.env.NODE_ENV ??= 'test';
  process.env.FRONTEND_ORIGIN ??= 'http://localhost:52201';
  process.env.DATABASE_URL ??= 'file:./backend.sqlite';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      AppModule.register({
        llm: integrationLlm(),
        nodeEnv: 'test',
      }),
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionLoggingFilter());
  await app.init();
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('createTestApp: failed to resolve listen address');
  }

  app.enableShutdownHooks();
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
