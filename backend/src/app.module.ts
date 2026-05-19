import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ResponseValidationInterceptor } from './validation/response-validation.interceptor.js';
import { AgentsModule } from './agents/agents.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LlmProvidersModule } from './llmProviders/llmProviders.module.js';
import { ModelPresetsModule } from './model-presets/model-presets.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SseModule } from './sse/sse.module.js';
import { SystemModule } from './system/system.module.js';
import { TerminalModule } from './terminal/terminal.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { UploadsModule } from './uploads/uploads.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    DatabaseModule,
    HealthModule,
    ConversationsModule,
    AgentsModule,
    SettingsModule,
    ModelPresetsModule,
    LlmProvidersModule,
    SseModule,
    SystemModule,
    TerminalModule,
    ToolsModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: ResponseValidationInterceptor },
  ],
})
export class AppModule {}
