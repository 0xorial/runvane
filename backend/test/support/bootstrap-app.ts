import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from '../../src/app.module';
import { HttpExceptionLoggingFilter } from '../../src/http/http-exception-logging.filter';

export type TestApp = {
  app: INestApplication;
  baseUrl: string;
};

function configureIntegrationLlm(): void {
  const live = process.env.INTEGRATION_LIVE_LLM === '1';
  process.env.LLM_TEST_STUB = live ? '0' : '1';
}

export async function createTestApp(): Promise<TestApp> {
  configureIntegrationLlm();
  process.env.FRONTEND_ORIGIN ??= 'http://localhost:52201';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
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
