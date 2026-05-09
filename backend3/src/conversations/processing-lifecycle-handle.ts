export class ProcessingLifecycleHandle {
  private readonly controller = new AbortController();
  private finished = false;

  constructor(private readonly onFinished: () => void) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(): void {
    this.controller.abort();
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.onFinished();
  }
}
