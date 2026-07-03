import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { TaskSseType, type TaskInfo, type TaskSseEvent } from '../contracts/task.js';

/**
 * Flat, in-process registry of in-flight cancellable tasks.
 *
 * Each `run(...)` registers a task with its own `AbortController`, publishes
 * SSE events on lifecycle transitions, and removes the task once the wrapped
 * function settles. The registry is intentionally oblivious to lineage —
 * each task is an atomic unit from its perspective. Higher layers (e.g.
 * `LifecycleScope`) may pass a `parentSignal` to chain external cancellation
 * into the task's controller without coupling the registry to that lineage.
 */
@Injectable()
export class TaskRegistryService {
  private readonly logger = new Logger(TaskRegistryService.name);
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly bus = new Subject<TaskSseEvent>();

  list(): TaskInfo[] {
    return [...this.tasks.values()].map(toInfo);
  }

  stream(): Observable<TaskSseEvent> {
    return this.bus.asObservable();
  }

  /** Mark task as cancelling and abort its signal. Returns false if unknown. */
  cancel(id: string): boolean {
    const rec = this.tasks.get(id);
    if (!rec) return false;
    if (rec.status === 'cancelling') return true;
    rec.status = 'cancelling';
    this.bus.next({ type: TaskSseType.UPSERT, task: toInfo(rec) });
    rec.controller.abort();
    return true;
  }

  /** Cancel every task whose `conversationId` matches. Returns count. */
  cancelByConversation(conversationId: string): number {
    let n = 0;
    for (const rec of this.tasks.values()) {
      if (rec.conversationId === conversationId) {
        this.cancel(rec.id);
        n++;
      }
    }
    return n;
  }

  /** Update a task's live progress line and publish the change. */
  setProgress(id: string, progress: string): void {
    const rec = this.tasks.get(id);
    if (!rec) return;
    rec.progress = progress;
    this.bus.next({ type: TaskSseType.UPSERT, task: toInfo(rec) });
  }

  async run<T>(
    spec: {
      kind: TaskInfo['kind'];
      title: string;
      conversationId?: string | null;
      parentSignal?: AbortSignal;
      meta?: Record<string, string>;
    },
    fn: (signal: AbortSignal, taskId: string) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const detach = chainAbort(spec.parentSignal, controller);
    const id = cryptoRandomId();
    const rec: TaskRecord = {
      id,
      kind: spec.kind,
      title: spec.title.trim() || spec.kind,
      conversationId: spec.conversationId ?? null,
      status: 'running',
      startedAt: new Date().toISOString(),
      progress: null,
      meta: spec.meta ?? {},
      controller,
    };
    this.tasks.set(id, rec);
    this.bus.next({ type: TaskSseType.UPSERT, task: toInfo(rec) });
    try {
      return await fn(controller.signal, id);
    } finally {
      detach();
      this.tasks.delete(id);
      this.bus.next({ type: TaskSseType.REMOVED, id });
    }
  }
}

type TaskRecord = TaskInfo & {
  controller: AbortController;
  status: 'running' | 'cancelling';
};

function toInfo(rec: TaskRecord): TaskInfo {
  const { controller: _c, ...info } = rec;
  return info;
}

function chainAbort(parent: AbortSignal | undefined, child: AbortController): () => void {
  if (!parent) return () => {};
  if (parent.aborted) {
    child.abort();
    return () => {};
  }
  const onAbort = () => child.abort();
  parent.addEventListener('abort', onAbort, { once: true });
  return () => parent.removeEventListener('abort', onAbort);
}

function cryptoRandomId(): string {
  return crypto.randomUUID();
}
