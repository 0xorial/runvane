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
import { ToolHostModule } from './tool-host/tool-host.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { TestHarnessModule } from './test-harness/test-harness.module.js';

// Honor LOG_LEVEL so a failing test run always has real backend logs (pino-http
// logs every request: method, url, status, responseTime). Default test to
// 'silent' only so unit-test output stays clean; the e2e/integration harness
// sets LOG_LEVEL to turn logging on. In test the backend runs in-process and
// the destination is process.stdout, so the harness tee
// (scripts/test-diagnostics.mjs) captures the logs into the run's log file.
function pinoHttpOptions(nodeEnv: RunvaneRuntimeConfig['nodeEnv']) {
  return {
    level: process.env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    transport: nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
    serializers: {
      req(req: { id?: unknown; method?: string; url?: string }) {
        return { id: req.id, method: req.method, url: req.url };
      },
      res(res: { statusCode?: number }) {
        return { statusCode: res.statusCode };
      },
    },
  };
}

@Module({})
export class AppModule {
  static register(runtime: RunvaneRuntimeConfig): DynamicModule {
    const stubHarness = runtime.nodeEnv === 'test' && runtime.llm.mode === 'stub';
    return {
      module: AppModule,
      imports: [
        RuntimeModule.forRoot(runtime),
        LoggerModule.forRoot({
          // Honor LOG_LEVEL so a failing test run always has real backend logs
          // (pino-http logs every request: method, url, status, responseTime).
          // Default test to 'silent' only so unit-test output stays clean; the
          // e2e/integration harness sets LOG_LEVEL to turn logging on. In test the
          // backend runs in-process, so the destination is process.stdout — the
          // harness tee (scripts/test-diagnostics.mjs) captures that into the log
          // file, whereas pino's default direct-to-fd write would bypass it.
          pinoHttp:
            runtime.nodeEnv === 'test'
              ? [pinoHttpOptions(runtime.nodeEnv), process.stdout]
              : pinoHttpOptions(runtime.nodeEnv),
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
        ToolHostModule,
        KnowledgeModule,
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
