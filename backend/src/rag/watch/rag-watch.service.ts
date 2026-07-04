import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EntitySourceRegistry } from '../sources/entity-source.registry.js';
import { IngestRunner } from '../ingestion/ingest-runner.service.js';
import { StorageRegistry } from '../store/storage-registry.service.js';

/** Quiet period after the last source change before an ingest fires. */
const WATCH_DEBOUNCE_MS = 1_000;

/**
 * Keeps watched storages in sync with their sources: for every storage whose
 * manifest has `watch: true` (and whose entity source can watch), subscribe
 * to change notifications and trigger a debounced ingest through the shared
 * runner — so an edit to an indexed file re-embeds (and, with a graph layer,
 * re-extracts) just that file, and the change is visible as a normal running
 * task. Newly started watchers ingest once immediately, so enabling watch
 * also catches up on anything that changed while it was off.
 */
@Injectable()
export class RagWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RagWatchService.name);
  private readonly watchers = new Map<string, AbortController>();
  private readonly debounces = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly storages: StorageRegistry,
    private readonly sources: EntitySourceRegistry,
    private readonly runner: IngestRunner,
  ) {}

  onModuleInit(): void {
    this.reconcile();
  }

  onModuleDestroy(): void {
    for (const timer of this.debounces.values()) clearTimeout(timer);
    this.debounces.clear();
    for (const controller of this.watchers.values()) controller.abort();
    this.watchers.clear();
  }

  /** Storage ids currently being watched (for the API/UI). */
  watchedIds(): string[] {
    return [...this.watchers.keys()];
  }

  /** Drop a storage's watcher (its params changed) and re-reconcile so it
   *  comes back subscribed to the current sourceParams. */
  restart(storageId: string): void {
    const controller = this.watchers.get(storageId);
    if (controller) {
      controller.abort();
      this.watchers.delete(storageId);
    }
    const timer = this.debounces.get(storageId);
    if (timer) clearTimeout(timer);
    this.debounces.delete(storageId);
    this.reconcile();
  }

  /** Start/stop watchers to match the manifests. Call after any manifest
   *  create/update/delete that could change the watched set. */
  reconcile(): void {
    const wanted = new Set<string>();
    for (const manifest of this.storages.listManifests()) {
      if (!manifest.watch) continue;
      const source = this.sources.get(manifest.entitySource);
      if (!source?.watch) continue;
      wanted.add(manifest.id);

      if (this.watchers.has(manifest.id)) continue;
      const controller = new AbortController();
      this.watchers.set(manifest.id, controller);
      try {
        source.watch(manifest.sourceParams, () => this.schedule(manifest.id), controller.signal);
      } catch (error) {
        this.logger.warn(`watch '${manifest.id}' failed to start: ${String(error)}`);
        this.watchers.delete(manifest.id);
        continue;
      }
      this.schedule(manifest.id); // catch up on changes made while unwatched
    }

    for (const [id, controller] of this.watchers) {
      if (wanted.has(id)) continue;
      controller.abort();
      this.watchers.delete(id);
      const timer = this.debounces.get(id);
      if (timer) clearTimeout(timer);
      this.debounces.delete(id);
    }
  }

  private schedule(storageId: string): void {
    const existing = this.debounces.get(storageId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.debounces.delete(storageId);
      void this.runner.run(storageId, 'watch').catch((error) => {
        this.logger.warn(`watch ingest of '${storageId}' failed: ${String(error)}`);
      });
    }, WATCH_DEBOUNCE_MS);
    timer.unref?.();
    this.debounces.set(storageId, timer);
  }
}
