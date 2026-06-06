import { Injectable } from '@nestjs/common';
import type { OriginClass } from './capture-creation-stack.js';
import type { WorkFrame } from './work-context.js';

const STALE_HOOK_MS = 30_000;

export type AsyncEntryKind =
  | 'timer'
  | 'interval'
  | 'immediate'
  | 'next_tick'
  | 'microtask'
  | 'async_hook';

export type AsyncTaskEntry = {
  id: string;
  kind: AsyncEntryKind;
  label: string;
  contextPath: string | null;
  conversationId: string | null;
  scheduledAt: string;
  hookType: string | null;
  detail: string | null;
  /** Tied to a lifecycle scope / conversation context. */
  attributed: boolean;
  suspicious: boolean;
  originClass: OriginClass;
  originSite: string | null;
  originStack: string[];
  hookAsyncId: number | null;
  triggerAsyncId: number | null;
  /** init without after for a while — callback not run yet (I/O wait or no callback). */
  stale: boolean;
  /** RUNNING framework hook from the /api/work request that is reading the monitor. */
  observingSelf: boolean;
  state: 'scheduled' | 'running';
};

type ScheduleInput = {
  kind: AsyncEntryKind;
  label: string;
  contextPath: string | null;
  conversationId: string | null;
  hookType?: string | null;
  detail?: string | null;
  attributed?: boolean;
  suspicious?: boolean;
  originClass?: OriginClass;
  originSite?: string | null;
  originStack?: string[];
  hookAsyncId?: number | null;
  triggerAsyncId?: number | null;
};

let nextEntryId = 1;

@Injectable()
export class AsyncTaskMonitorService {
  private readonly entries = new Map<string, AsyncTaskEntry>();
  private readonly handleToId = new Map<unknown, string>();

  register(input: ScheduleInput): string {
    const id = `async-${nextEntryId++}`;
    const attributed = input.attributed ?? !!(input.contextPath || input.conversationId);
    this.entries.set(id, {
      id,
      kind: input.kind,
      label: input.label,
      contextPath: input.contextPath,
      conversationId: input.conversationId,
      scheduledAt: new Date().toISOString(),
      hookType: input.hookType ?? null,
      detail: input.detail ?? null,
      attributed,
      suspicious: input.suspicious ?? false,
      originClass: input.originClass ?? (attributed ? 'none' : 'unknown'),
      originSite: input.originSite ?? null,
      originStack: input.originStack ?? [],
      hookAsyncId: input.hookAsyncId ?? null,
      triggerAsyncId: input.triggerAsyncId ?? null,
      stale: false,
      observingSelf: false,
      state: 'scheduled',
    });
    return id;
  }

  summary(): { attributed: number; suspicious: number; unattributedInfra: number } {
    let attributed = 0;
    let suspicious = 0;
    let unattributedInfra = 0;
    for (const e of this.entries.values()) {
      if (e.attributed) attributed++;
      else if (e.suspicious) suspicious++;
      else unattributedInfra++;
    }
    return { attributed, suspicious, unattributedInfra };
  }

  linkHandle(id: string, handle: unknown): void {
    this.handleToId.set(handle, id);
  }

  private entryIdForHandle(handle: unknown): string | null {
    return this.handleToId.get(handle) ?? null;
  }

  markRunning(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.state = 'running';
  }

  markRunningByHandle(handle: unknown): void {
    const id = this.entryIdForHandle(handle);
    if (id) this.markRunning(id);
  }

  markScheduled(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.state = 'scheduled';
  }

  markScheduledByHandle(handle: unknown): void {
    const id = this.entryIdForHandle(handle);
    if (id) this.markScheduled(id);
  }

  complete(id: string): void {
    this.entries.delete(id);
    for (const [handle, mapped] of this.handleToId) {
      if (mapped === id) this.handleToId.delete(handle);
    }
  }

  cancelByHandle(handle: unknown): void {
    this.completeByHandle(handle);
  }

  completeByHandle(handle: unknown): void {
    const id = this.handleToId.get(handle);
    if (!id) return;
    this.handleToId.delete(handle);
    this.entries.delete(id);
  }

  list(): AsyncTaskEntry[] {
    const now = Date.now();
    return [...this.entries.values()]
      .map((entry) => ({
        ...entry,
        stale:
          entry.kind === 'async_hook' &&
          entry.state === 'scheduled' &&
          now - Date.parse(entry.scheduledAt) > STALE_HOOK_MS,
        observingSelf:
          entry.kind === 'async_hook' &&
          entry.state === 'running' &&
          entry.originClass === 'framework' &&
          now - Date.parse(entry.scheduledAt) < 250,
      }))
      .sort((a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt));
  }

  pendingCount(): number {
    return this.entries.size;
  }

  contextFromFrames(frames: readonly WorkFrame[]): {
    contextPath: string | null;
    conversationId: string | null;
    label: string;
  } {
    if (frames.length === 0) {
      return { contextPath: null, conversationId: null, label: 'system' };
    }
    const contextPath = frames.map((f) => f.label).join(' › ');
    return {
      contextPath,
      conversationId: frames[0].scope.conversationId,
      label: contextPath,
    };
  }
}
