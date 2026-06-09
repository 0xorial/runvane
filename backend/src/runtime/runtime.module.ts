import { DynamicModule, Global, Module } from '@nestjs/common';
import type { RunvaneRuntimeConfig } from './runtime.config.js';
import { RUNVANE_RUNTIME } from './runtime.tokens.js';

@Global()
@Module({})
export class RuntimeModule {
  static forRoot(config: RunvaneRuntimeConfig): DynamicModule {
    return {
      module: RuntimeModule,
      providers: [{ provide: RUNVANE_RUNTIME, useValue: config }],
      exports: [RUNVANE_RUNTIME],
    };
  }
}
