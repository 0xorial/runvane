import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'runvane-backend',
      queue_depth: 0,
    } as const;
  }
}
