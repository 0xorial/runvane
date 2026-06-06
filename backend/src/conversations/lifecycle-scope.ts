/**
 * Structured-concurrency scope for processing pipelines.
 *
 * Pass this object instead of a bare AbortSignal so any layer can spawn
 * fire-and-forget child work via `spawn(...)`. The scope's `onFinished`
 * callback only fires after the synchronous root portion has called
 * `rootDone()` AND every spawned child has settled. This makes lifecycle
 * cleanup (e.g. removing the scope from an in-flight map) safe even when
 * deeper layers branch into background tasks.
 */
export class LifecycleScope {
  private readonly controller = new AbortController();
  private readonly finishedPromise: Promise<void>;
  private readonly resolveFinished: () => void;
  private pending = 0;
  private rootSettled = false;
  private finished = false;

  constructor(
    private readonly onFinished: () => void,
    private readonly onSpawnError: (error: unknown) => void,
  ) {
    let resolveFinished!: () => void;
    this.finishedPromise = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    this.resolveFinished = resolveFinished;
  }

  whenFinished(): Promise<void> {
    return this.finishedPromise;
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

  spawn(fn: () => Promise<void>): void {
    this.pending++;
    void Promise.resolve()
      .then(fn)
      .catch((error) => this.onSpawnError(error))
      .finally(() => this.settleOne());
  }

  rootDone(): void {
    if (this.rootSettled) return;
    this.rootSettled = true;
    this.maybeFinish();
  }

  private settleOne(): void {
    this.pending--;
    this.maybeFinish();
  }

  private maybeFinish(): void {
    if (this.finished) return;
    if (this.rootSettled && this.pending === 0) {
      this.finished = true;
      this.onFinished();
      this.resolveFinished();
    }
  }
}
