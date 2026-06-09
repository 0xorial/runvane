import type { StubModelScript, StubQueuedResponse } from './stubLlm.control.js';

export class StubLlmQueue {
  private readonly byModel = new Map<string, StubQueuedResponse[]>();
  private readonly fallback: StubQueuedResponse[] = [];

  configure(scripts: StubModelScript[], append: boolean): void {
    if (!append) {
      this.clearQueues();
      this.fallback.length = 0;
    }
    for (const { model, responses } of scripts) {
      if (model) {
        const q = append ? (this.byModel.get(model) ?? []) : [];
        q.push(...responses);
        this.byModel.set(model, q);
      } else {
        this.fallback.push(...responses);
      }
    }
  }

  pushFallback(text: string): void {
    this.fallback.push({ text });
  }

  pushFallbackMany(texts: string[]): void {
    for (const text of texts) this.fallback.push({ text });
  }

  reset(): void {
    this.clearQueues();
    this.fallback.length = 0;
  }

  pendingCount(): number {
    let n = this.fallback.length;
    for (const q of this.byModel.values()) n += q.length;
    return n;
  }

  /** Title generation and tool-param extraction (parallel with planner on first message). */
  takeInstant(): StubQueuedResponse | undefined {
    if (!this.fallback.length) return undefined;
    return this.fallback.shift();
  }

  takeCompletion(model: string): StubQueuedResponse | undefined {
    const modelQ = this.byModel.get(model);
    if (modelQ?.length) return modelQ.shift();
    if (this.fallback.length) return this.fallback.shift();
    return undefined;
  }

  private clearQueues(): void {
    this.byModel.clear();
  }
}
