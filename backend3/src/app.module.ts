import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AgentsModule } from './agents/agents.module.js';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConversationsModule } from './conversations/conversations.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LlmProvidersModule } from './llmProviders/llmProviders.module.js';
import { ModelPresetsModule } from './model-presets/model-presets.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SseModule } from './sse/sse.module.js';
import { SystemModule } from './system/system.module.js';
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
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
