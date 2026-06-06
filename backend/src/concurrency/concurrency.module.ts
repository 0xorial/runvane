import { Global, Module } from '@nestjs/common';
import { AsyncTaskMonitorService } from './async-task-monitor.service.js';
import { bootstrapAsyncMonitoring } from './install-async-monitoring.js';
import { WorkController } from './work.controller.js';
import { WorkMonitorService } from './work-monitor.service.js';

@Global()
@Module({
  controllers: [WorkController],
  providers: [
    WorkMonitorService,
    { provide: AsyncTaskMonitorService, useFactory: () => bootstrapAsyncMonitoring() },
  ],
  exports: [WorkMonitorService, AsyncTaskMonitorService],
})
export class ConcurrencyModule {}
