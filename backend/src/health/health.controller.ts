import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'runvane-backend',
      queue_depth: 0,
      llmMode: process.env.LLM_TEST_STUB === '1' ? 'stub' : 'live',
    } as const;
  }
}
