import type { AsyncEntryKind, AsyncTaskMonitorService } from './async-task-monitor.service.js';
import { runWithWorkFrames, snapshotWorkFrames } from './work-context.js';

export type NativeTimers = {
  setTimeout: typeof setTimeout;
  setInterval: typeof setInterval;
  setImmediate: typeof setImmediate;
  clearTimeout: typeof clearTimeout;
  clearInterval: typeof clearInterval;
  clearImmediate: typeof clearImmediate;
  nextTick: typeof process.nextTick;
  queueMicrotask: typeof queueMicrotask;
};

/** Unpatched schedulers — bypass the monitor (WorkScope timer internals). */
export const nativeTimers: NativeTimers = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  setInterval: globalThis.setInterval.bind(globalThis),
  setImmediate: globalThis.setImmediate.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
  clearImmediate: globalThis.clearImmediate.bind(globalThis),
  nextTick: process.nextTick.bind(process),
  queueMicrotask: queueMicrotask.bind(globalThis),
};

let installed = false;
/** Avoid re-entrancy when monitor internals schedule async work (e.g. crypto). */
let insideMonitor = false;

/**
 * Patch Node schedulers for labeled tracking (delay, interval ms, work context).
 * Complements `async-hooks-monitor.ts` which catches all other libuv handles.
 * Scheduler hook types (TIMERWRAP, PROMISE, …) are skipped there to avoid duplicates.
 */
export function installAsyncEntryPatches(monitor: AsyncTaskMonitorService): void {
  if (installed) return;
  installed = true;

  const wrapOneShot = (frames: ReturnType<typeof snapshotWorkFrames>, id: string, fn: () => void) => {
    return () => {
      monitor.markRunning(id);
      runWithWorkFrames(frames, () => {
        try {
          fn();
        } finally {
          monitor.complete(id);
        }
      });
    };
  };

  const wrapRepeating = (frames: ReturnType<typeof snapshotWorkFrames>, id: string, fn: () => void) => {
    return () => {
      monitor.markRunning(id);
      runWithWorkFrames(frames, () => {
        try {
          fn();
        } finally {
          monitor.markScheduled(id);
        }
      });
    };
  };

  const track = (kind: AsyncEntryKind, detail: string | null, fn: () => void) => {
    if (insideMonitor) return fn;
    const frames = snapshotWorkFrames();
    const ctx = monitor.contextFromFrames(frames);
    insideMonitor = true;
    let id: string;
    try {
      id = monitor.register({ kind, ...ctx, detail });
    } finally {
      insideMonitor = false;
    }
    return wrapOneShot(frames, id, fn);
  };

  const trackHandle = (
    kind: AsyncEntryKind,
    detail: string | null,
    schedule: (wrapped: () => void) => unknown,
    fn: () => void,
  ) => {
    if (insideMonitor) return schedule(fn);
    const frames = snapshotWorkFrames();
    const ctx = monitor.contextFromFrames(frames);
    insideMonitor = true;
    let id: string;
    try {
      id = monitor.register({ kind, ...ctx, detail });
    } finally {
      insideMonitor = false;
    }
    const handle = schedule(wrapOneShot(frames, id, fn));
    monitor.linkHandle(id, handle);
    return handle;
  };

  const trackRepeatingHandle = (
    kind: AsyncEntryKind,
    detail: string | null,
    schedule: (wrapped: () => void) => unknown,
    fn: () => void,
  ) => {
    if (insideMonitor) return schedule(fn);
    const frames = snapshotWorkFrames();
    const ctx = monitor.contextFromFrames(frames);
    insideMonitor = true;
    let id: string;
    try {
      id = monitor.register({ kind, ...ctx, detail });
    } finally {
      insideMonitor = false;
    }
    const handle = schedule(wrapRepeating(frames, id, fn));
    monitor.linkHandle(id, handle);
    return handle;
  };

  globalThis.setTimeout = ((fn: (...args: never[]) => void, ms?: number, ...args: never[]) => {
    return trackHandle(
      'timer',
      `${ms ?? 0}ms`,
      (wrapped) => nativeTimers.setTimeout(wrapped, ms ?? 0),
      () => {
        fn(...args);
      },
    );
  }) as typeof setTimeout;

  globalThis.setInterval = ((fn: (...args: never[]) => void, ms?: number, ...args: never[]) => {
    return trackRepeatingHandle(
      'interval',
      `${ms ?? 0}ms`,
      (wrapped) => nativeTimers.setInterval(wrapped, ms ?? 0),
      () => {
        fn(...args);
      },
    );
  }) as typeof setInterval;

  globalThis.setImmediate = ((fn: (...args: never[]) => void, ...args: never[]) => {
    return trackHandle(
      'immediate',
      null,
      (wrapped) => nativeTimers.setImmediate(wrapped),
      () => {
        fn(...args);
      },
    );
  }) as unknown as typeof setImmediate;

  globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
    monitor.cancelByHandle(handle);
    return nativeTimers.clearTimeout(handle);
  }) as typeof clearTimeout;

  globalThis.clearInterval = ((handle: Parameters<typeof clearInterval>[0]) => {
    monitor.cancelByHandle(handle);
    return nativeTimers.clearInterval(handle);
  }) as typeof clearInterval;

  globalThis.clearImmediate = ((handle: Parameters<typeof clearImmediate>[0]) => {
    monitor.cancelByHandle(handle);
    return nativeTimers.clearImmediate(handle);
  }) as typeof clearImmediate;

  process.nextTick = ((fn: (...args: never[]) => void, ...args: never[]) => {
    return nativeTimers.nextTick(
      track('next_tick', null, () => {
        fn(...args);
      }),
    );
  }) as typeof process.nextTick;

  globalThis.queueMicrotask = ((fn: () => void) => {
    return nativeTimers.queueMicrotask(track('microtask', null, fn));
  }) as typeof queueMicrotask;
}
