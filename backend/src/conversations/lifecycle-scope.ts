import type { PendingWorkItem, PendingWorkKind, WorkMonitorService } from '../concurrency/work-monitor.service.js';
import {
  getWorkContextPath,
  runInWorkContext,
  runInWorkContextAsync,
} from '../concurrency/work-context.js';

export type LifecycleScopeOptions = {
  label: string;
  conversationId?: string | null;
  monitor: WorkMonitorService;
};

type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Structured-concurrency scope for processing pipelines (layer 1).
 *
 * All background work must go through `spawn`, `run`, `delay`, or
 * `scheduleTimeout` — never raw `setTimeout`. Work is tracked in
 * `WorkMonitorService` and bound via an AsyncLocalStorage frame stack
 * (.NET AsyncLocal-style) for each branch.
 *
 * User-visible cancellable units (LLM/tool) are layer 2 (`TaskRegistryService`).
 */
export class LifecycleScope {
  readonly conversationId: string | null;
  private readonly controller = new AbortController();
  private readonly scopeId: string;
  private readonly monitor: WorkMonitorService;
  private readonly timers = new Set<TimerHandle>();
  private pending = 0;
  private rootSettled = false;
  private finished = false;

  constructor(
    private readonly onFinished: () => void,
    private readonly onSpawnError: (error: unknown) => void,
    options: LifecycleScopeOptions,
  ) {
    this.conversationId = options.conversationId ?? null;
    this.monitor = options.monitor;
    this.scopeId = this.monitor.registerScope({
      label: options.label,
      conversationId: options.conversationId,
    });
    this.controller.signal.addEventListener('abort', () => this.clearTimers(), { once: true });
  }

  get id(): string {
    return this.scopeId;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(): void {
    this.controller.abort();
  }

  throwIfAborted(): void {
    this.controller.signal.throwIfAborted();
  }

  /** Fire-and-forget async branch — increments pending until settled. */
  spawn(label: string, fn: () => Promise<void>): void {
    this.pending++;
    const workId = this.trackWork(label, 'spawn');
    void runInWorkContextAsync(this, label, async () => {
      try {
        await fn();
      } catch (error) {
        if (!this.isBenignAbort(error)) this.onSpawnError(error);
        throw error;
      }
    })
      .catch(() => undefined)
      .finally(() => {
        this.untrackWork(workId);
        this.settleOne();
      });
  }

  /** Tracked async work — use for promise chains that must stay accounted. */
  run<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const workId = this.trackWork(label, 'run');
    return runInWorkContextAsync(this, label, fn).finally(() => this.untrackWork(workId));
  }

  /** Abortable sleep registered with this scope. */
  delay(label: string, ms: number): Promise<void> {
    const workId = this.trackWork(label, 'delay');
    return new Promise<void>((resolve, reject) => {
      if (this.controller.signal.aborted) {
        this.untrackWork(workId);
        reject(this.abortError());
        return;
      }
      const onAbort = () => {
        handle.clear();
        this.untrackWork(workId);
        reject(this.abortError());
      };
      const handle = this.scheduleTimeout(`${label}:wake`, ms, () => {
        this.controller.signal.removeEventListener('abort', onAbort);
        this.untrackWork(workId);
        resolve();
      });
      this.controller.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** One-shot timer cleared on scope abort. Callback runs inside WorkScope ALS. */
  scheduleTimeout(label: string, ms: number, fn: () => void): { clear(): void } {
    this.throwIfAborted();
    const workId = this.trackWork(label, 'timer');
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      this.untrackWork(workId);
      if (this.controller.signal.aborted) return;
      runInWorkContext(this, label, fn);
    }, ms);
    this.timers.add(handle);
    return {
      clear: () => {
        clearTimeout(handle);
        this.timers.delete(handle);
        this.untrackWork(workId);
      },
    };
  }

  rootDone(): void {
    if (this.rootSettled) return;
    this.rootSettled = true;
    this.maybeFinish();
  }

  private trackWork(label: string, kind: PendingWorkKind): string {
    const id = crypto.randomUUID();
    const contextPath = getWorkContextPath();
    const item: PendingWorkItem = {
      id,
      label: contextPath ? `${contextPath} › ${label}` : label,
      kind,
      startedAt: new Date().toISOString(),
    };
    this.monitor.track(this.scopeId, item);
    return id;
  }

  private untrackWork(workId: string): void {
    this.monitor.untrack(this.scopeId, workId);
  }

  private settleOne(): void {
    this.pending--;
    this.maybeFinish();
  }

  private maybeFinish(): void {
    if (this.finished) return;
    if (this.rootSettled && this.pending === 0) {
      this.finished = true;
      this.clearTimers();
      this.monitor.unregisterScope(this.scopeId);
      this.onFinished();
    }
  }

  private clearTimers(): void {
    for (const handle of this.timers) clearTimeout(handle);
    this.timers.clear();
  }

  private abortError(): Error {
    return this.controller.signal.reason instanceof Error
      ? this.controller.signal.reason
      : new Error('Aborted', { cause: this.controller.signal.reason });
  }

  private isBenignAbort(error: unknown): boolean {
    if (this.controller.signal.aborted) return true;
    return error instanceof Error && error.name === 'AbortError';
  }
}
