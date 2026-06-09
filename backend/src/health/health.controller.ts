import { Controller, Get, Inject } from '@nestjs/common';
import type { RunvaneRuntimeConfig } from '../runtime/runtime.config.js';
import { RUNVANE_RUNTIME } from '../runtime/runtime.tokens.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(RUNVANE_RUNTIME) private readonly runtime: RunvaneRuntimeConfig) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'runvane-backend',
      queue_depth: 0,
      llmMode: this.runtime.llm.mode,
    } as const;
  }
}
