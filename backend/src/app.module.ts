import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ResponseValidationInterceptor } from './validation/response-validation.interceptor.js';
import { AgentsModule } from './agents/agents.module.js';
import { ImportModule } from './import/import.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LlmProvidersModule } from './llmProviders/llmProviders.module.js';
import { ModelPresetsModule } from './model-presets/model-presets.module.js';
import type { RunvaneRuntimeConfig } from './runtime/runtime.config.js';
import { RuntimeModule } from './runtime/runtime.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SseModule } from './sse/sse.module.js';
import { SystemModule } from './system/system.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { TerminalModule } from './terminal/terminal.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { TestHarnessModule } from './test-harness/test-harness.module.js';

@Module({})
export class AppModule {
  static register(runtime: RunvaneRuntimeConfig): DynamicModule {
    const stubHarness = runtime.nodeEnv === 'test' && runtime.llm.mode === 'stub';
    return {
      module: AppModule,
      imports: [
        RuntimeModule.forRoot(runtime),
        LoggerModule.forRoot({
          pinoHttp: {
            transport:
              runtime.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
            ...(runtime.nodeEnv === 'test' ? { level: 'silent' as const } : {}),
            serializers: {
              req(req) {
                return { id: req.id, method: req.method, url: req.url };
              },
              res(res) {
                return { statusCode: res.statusCode };
              },
            },
          },
        }),
        DatabaseModule,
        HealthModule,
        ConversationsModule,
        AgentsModule,
        ImportModule,
        SettingsModule,
        ModelPresetsModule,
        LlmProvidersModule.forRoot(runtime),
        SseModule,
        SystemModule,
        TasksModule,
        TerminalModule,
        ToolsModule,
        UploadsModule,
        ...(stubHarness ? [TestHarnessModule] : []),
      ],
      controllers: [AppController],
      providers: [
        AppService,
        { provide: APP_INTERCEPTOR, useClass: ResponseValidationInterceptor },
      ],
    };
  }
}
