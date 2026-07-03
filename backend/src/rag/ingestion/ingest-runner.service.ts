import { Injectable, Logger } from '@nestjs/common';
import { TaskRegistryService } from '../../tasks/task-registry.service.js';
import { StorageRegistry } from '../store/storage-registry.service.js';
import { IngestionService } from './ingestion.service.js';
import type { IngestResult } from '../contracts/rag.js';

export type IngestTrigger = 'manual' | 'watch';

/**
 * Runs storage ingests as registry tasks — visible and cancellable in the
 * running-tasks UI, with live progress — and serializes them per storage. A
 * request arriving while that storage is already indexing marks the run dirty
 * and re-runs once after it settles, so a burst of file events coalesces into
 * at most one follow-up ingest.
 */
@Injectable()
export class IngestRunner {
  private readonly logger = new Logger(IngestRunner.name);
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    private readonly ingestion: IngestionService,
    private readonly storages: StorageRegistry,
    private readonly tasks: TaskRegistryService,
  ) {}

  isRunning(storageId: string): boolean {
    return this.active.has(storageId);
  }

  /** Start (or join) an ingest for the storage. Joining callers get the
   *  in-flight run's result; the follow-up run happens in the background. */
  run(storageId: string, trigger: IngestTrigger): Promise<IngestResult> {
    const current = this.active.get(storageId);
    if (current) {
      current.pending = true;
      return current.promise;
    }
    let entry!: ActiveRun;
    const promise = this.execute(storageId, trigger).finally(() => {
      this.active.delete(storageId);
      if (entry.pending) {
        void this.run(storageId, trigger).catch((error) => {
          this.logger.warn(`coalesced re-ingest of '${storageId}' failed: ${String(error)}`);
        });
      }
    });
    entry = { promise, pending: false };
    this.active.set(storageId, entry);
    return promise;
  }

  private execute(storageId: string, trigger: IngestTrigger): Promise<IngestResult> {
    const name = this.storages.getManifest(storageId)?.name ?? storageId;
    return this.tasks.run(
      { kind: 'ingest', title: `Index "${name}"`, meta: { storageId, trigger } },
      (signal, taskId) =>
        this.ingestion.ingest(storageId, {
          signal,
          onProgress: (p) =>
            this.tasks.setProgress(taskId, `${p.added} added · ${p.updated} updated · ${p.skipped} skipped`),
        }),
    );
  }
}

type ActiveRun = { promise: Promise<IngestResult>; pending: boolean };
