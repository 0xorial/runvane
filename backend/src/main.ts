import { Logger } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { HttpExceptionLoggingFilter } from './http/http-exception-logging.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useWebSocketAdapter(new WsAdapter(app));
  const frontendOrigin = process.env.FRONTEND_ORIGIN;
  if (!frontendOrigin) {
    throw new Error('FRONTEND_ORIGIN is required (set via dev-ports/with-ports.mjs or .env.ports)');
  }
  const port = process.env.PORT;
  if (!port) {
    throw new Error('PORT is required (set via dev-ports/with-ports.mjs or .env.ports)');
  }
  const frontendPort = new URL(frontendOrigin).port;
  if (!frontendPort) {
    throw new Error(`FRONTEND_ORIGIN must include a port: ${frontendOrigin}`);
  }
  app.enableCors({
    origin: [`http://localhost:${frontendPort}`, `http://127.0.0.1:${frontendPort}`],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionLoggingFilter());
  await app.listen(Number(port));
}
void bootstrap();
