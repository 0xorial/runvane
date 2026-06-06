import { Controller, Get } from '@nestjs/common';
import { validateGetWorkMonitorResponse } from '../contracts/work.js';
import { AsyncTaskMonitorService } from './async-task-monitor.service.js';
import { WorkMonitorService } from './work-monitor.service.js';

@Controller('api/work')
export class WorkController {
  constructor(
    private readonly workMonitor: WorkMonitorService,
    private readonly asyncMonitor: AsyncTaskMonitorService,
  ) {}

  @Get()
  list() {
    const pendingScopes = this.workMonitor.totalPending();
    const pendingAsync = this.asyncMonitor.pendingCount();
    const asyncSummary = this.asyncMonitor.summary();
    return validateGetWorkMonitorResponse({
      pending_work: pendingScopes + pendingAsync,
      pending_scopes: pendingScopes,
      pending_async: pendingAsync,
      async_summary: {
        attributed: asyncSummary.attributed,
        suspicious: asyncSummary.suspicious,
        unattributed_infra: asyncSummary.unattributedInfra,
      },
      scopes: this.workMonitor.listScopes(),
      async_entries: this.asyncMonitor.list(),
    });
  }
}
