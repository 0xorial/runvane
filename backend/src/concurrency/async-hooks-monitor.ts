import { createHook } from 'node:async_hooks';
import { captureCreationStack, classifyOrigin } from './capture-creation-stack.js';
import type { AsyncTaskMonitorService } from './async-task-monitor.service.js';
import { snapshotWorkFrames } from './work-context.js';

/** init = started · before/after = callback runs · after = done · destroy = fallback cleanup */
const SKIP_DUPLICATE_TYPES = new Set(['TIMERWRAP', 'Timeout', 'Immediate', 'TickObject', 'PROMISE']);

/** Process infra — unattributed is expected, not "forgotten app code". */
const KNOWN_INFRA_TYPES = new Set([
  'TCPSERVERWRAP',
  'MESSAGEPORT',
  'WORKER',
  'SIGNALWRAP',
  'CustomGC',
  'napi_rs_threadsafe_function',
]);

type InheritedContext = {
  contextPath: string | null;
  conversationId: string | null;
};

let insideMonitor = false;
let installed = false;

export function installAsyncHooksMonitor(monitor: AsyncTaskMonitorService): void {
  if (installed) return;
  installed = true;

  const asyncContext = new Map<number, InheritedContext>();
  const triggerParent = new Map<number, number>();

  const resolveContext = (triggerAsyncId: number): InheritedContext => {
    const frames = snapshotWorkFrames();
    const direct = monitor.contextFromFrames(frames);
    if (direct.contextPath || direct.conversationId) {
      return { contextPath: direct.contextPath, conversationId: direct.conversationId };
    }
    let parent = triggerAsyncId;
    while (parent) {
      const inherited = asyncContext.get(parent);
      if (inherited?.contextPath || inherited?.conversationId) return inherited;
      parent = triggerParent.get(parent) ?? 0;
    }
    return { contextPath: null, conversationId: null };
  };

  createHook({
    init(asyncId: number, type: string, triggerAsyncId: number) {
      if (insideMonitor || SKIP_DUPLICATE_TYPES.has(type)) return;

      triggerParent.set(asyncId, triggerAsyncId);
      const ctx = resolveContext(triggerAsyncId);
      const attributed = !!(ctx.contextPath || ctx.conversationId);
      asyncContext.set(asyncId, ctx);

      const rawStack = attributed ? [] : captureCreationStack();
      const origin = attributed ? { kind: 'unknown' as const, label: null } : classifyOrigin(rawStack);
      const originClass = attributed ? 'none' : origin.kind;
      const suspicious = !attributed && origin.kind === 'app';
      const originSite = origin.label;
      const displayLabel =
        ctx.contextPath ??
        origin.label ??
        (KNOWN_INFRA_TYPES.has(type) ? type : humanizeHookType(type));

      insideMonitor = true;
      let id: string;
      try {
        id = monitor.register({
          kind: 'async_hook',
          label: displayLabel,
          contextPath: ctx.contextPath,
          conversationId: ctx.conversationId,
          hookType: type,
          detail: type,
          attributed,
          suspicious,
          originClass,
          originStack: rawStack,
          originSite,
          hookAsyncId: asyncId,
          triggerAsyncId,
        });
      } finally {
        insideMonitor = false;
      }
      monitor.linkHandle(id, asyncId);
    },
    before(asyncId: number) {
      monitor.markRunningByHandle(asyncId);
    },
    after(asyncId: number) {
      monitor.completeByHandle(asyncId);
    },
    destroy(asyncId: number) {
      asyncContext.delete(asyncId);
      triggerParent.delete(asyncId);
      monitor.completeByHandle(asyncId);
    },
  }).enable();
}

function humanizeHookType(type: string): string {
  if (type === 'bound-anonymous-fn') return 'Native driver callback';
  return type;
}
