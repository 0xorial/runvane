import type { TaskQueueHint } from "../domain/agentTask.js";
import { logger } from "./logger.js";

type TaskHandler = (hint: TaskQueueHint) => Promise<void>;

export class InMemoryJobQueue {
  private readonly pending: TaskQueueHint[] = [];
  private draining = false;
  private handler: TaskHandler | null = null;

  get depth(): number {
    return this.pending.length;
  }

  setHandler(handler: TaskHandler): void {
    this.handler = handler;
    this.kick();
  }

  enqueue(hint: TaskQueueHint): void {
    this.pending.push(hint);
    this.kick();
  }

  private kick(): void {
    if (this.draining || this.handler == null) return;
    this.draining = true;
    queueMicrotask(() => {
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    try {
      while (this.handler != null && this.pending.length > 0) {
        const hint = this.pending.shift();
        if (!hint) continue;
        try {
          await this.handler(hint);
        } catch (e) {
          logger.error({ taskId: hint.taskId, error: e }, "[backend] task failed");
        }
      }
    } finally {
      this.draining = false;
      if (this.handler != null && this.pending.length > 0) {
        this.kick();
      }
    }
  }
}
