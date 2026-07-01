import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from '../../../backend/src/app.module.js';
import { HttpExceptionLoggingFilter } from '../../../backend/src/http/http-exception-logging.filter.js';
import type { StubLlmControl } from '../../../backend/src/llmProviders/providers/stubLlm.control.js';
import { StubLlmProvider } from '../../../backend/src/llmProviders/providers/stubLlm.js';
import type { LlmRuntime } from '../../../backend/src/runtime/runtime.config.js';

export type TestApp = {
  app: INestApplication;
  baseUrl: string;
  stubLlm: StubLlmControl | null;
};

function integrationLlm(): LlmRuntime {
  return process.env.INTEGRATION_LIVE_LLM === '1' ? { mode: 'live' } : { mode: 'stub' };
}

export async function createTestApp(): Promise<TestApp> {
  process.env.NODE_ENV ??= 'test';
  process.env.FRONTEND_ORIGIN ??= 'http://localhost:52201';

  // Refuse to run against anything but an isolated, disposable DB under .e2e/.
  // No default fallback: an unset (or ambient rv-dev/rv-stable) DATABASE_URL
  // used to silently open a real DB and let tests write into it. Run via
  // `npm run test:integration`, which builds .e2e/integration.sqlite first.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !databaseUrl.includes('/.e2e/')) {
    throw new Error(
      `createTestApp: refusing to run against DATABASE_URL=${databaseUrl ?? '<unset>'}. ` +
        'Integration tests require an isolated DB under .e2e/ — run `npm run test:integration`.',
    );
  }

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
  const llm = integrationLlm();
  const stubLlm = llm.mode === 'stub' ? app.get(StubLlmProvider) : null;
  return { app, baseUrl: `http://127.0.0.1:${address.port}`, stubLlm };
}
