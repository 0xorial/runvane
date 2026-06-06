import { installAsyncEntryPatches } from './async-entry-patches.js';
import { installAsyncHooksMonitor } from './async-hooks-monitor.js';
import { AsyncTaskMonitorService } from './async-task-monitor.service.js';

let instance: AsyncTaskMonitorService | null = null;

/** Call once before `NestFactory.create` so patches are active during bootstrap. */
export function bootstrapAsyncMonitoring(): AsyncTaskMonitorService {
  if (!instance) {
    instance = new AsyncTaskMonitorService();
    installAsyncEntryPatches(instance);
    installAsyncHooksMonitor(instance);
  }
  return instance;
}

export function getAsyncTaskMonitor(): AsyncTaskMonitorService {
  if (!instance) {
    throw new Error('bootstrapAsyncMonitoring() must run before NestFactory.create');
  }
  return instance;
}
