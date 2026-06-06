import { Controller, Get } from '@nestjs/common';
import { AsyncTaskMonitorService } from '../concurrency/async-task-monitor.service.js';
import { WorkMonitorService } from '../concurrency/work-monitor.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly workMonitor: WorkMonitorService,
    private readonly asyncMonitor: AsyncTaskMonitorService,
  ) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'runvane-backend',
      pending_work: this.workMonitor.totalPending() + this.asyncMonitor.pendingCount(),
      active_scopes: this.workMonitor.listScopes().length,
      pending_async: this.asyncMonitor.pendingCount(),
    } as const;
  }

}
