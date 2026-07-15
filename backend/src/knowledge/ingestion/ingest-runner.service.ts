import { Injectable, Logger } from '@nestjs/common';
import { TaskRegistryService } from '../../tasks/task-registry.service.js';
import { StorageRegistry } from '../store/storage-registry.service.js';
import { IngestionService } from './ingestion.service.js';
import type { IngestResult } from '../contracts/knowledge.js';

export type IngestTrigger = 'manual' | 'watch' | 'agent';

const LOG_ACTOR: Record<IngestTrigger, 'user' | 'watcher' | 'agent'> = {
  manual: 'user',
  watch: 'watcher',
  agent: 'agent',
};

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

  private async execute(storageId: string, trigger: IngestTrigger): Promise<IngestResult> {
    const name = this.storages.getManifest(storageId)?.name ?? storageId;
    const startedAt = Date.now();
    try {
      const result = await this.tasks.run(
        { kind: 'ingest', title: `Index "${name}"`, meta: { storageId, trigger } },
        (signal, taskId) =>
          this.ingestion.ingest(storageId, {
            signal,
            onProgress: (p) =>
              this.tasks.setProgress(taskId, `${p.added} added · ${p.updated} updated · ${p.skipped} skipped`),
          }),
      );
      this.storages.open(storageId)?.appendLog('ingest', LOG_ACTOR[trigger], {
        trigger,
        duration_ms: Date.now() - startedAt,
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        removed: result.removed,
        total_chunks: result.totalChunks,
        total_sources: result.totalSources,
        ...(result.graph
          ? {
              nodes: result.graph.nodes,
              edges: result.graph.edges,
              graph_failures: result.graph.failedSources,
              graph_llm_calls: result.graph.llmCalls,
              graph_tokens: result.graph.promptTokens + result.graph.completionTokens,
              ...(result.graph.costUsd !== null ? { graph_cost_usd: result.graph.costUsd } : {}),
            }
          : {}),
      });
      return result;
    } catch (error) {
      this.storages.open(storageId)?.appendLog('ingest_failed', LOG_ACTOR[trigger], {
        trigger,
        duration_ms: Date.now() - startedAt,
        error: String(error).slice(0, 500),
      });
      throw error;
    }
  }
}

type ActiveRun = { promise: Promise<IngestResult>; pending: boolean };
