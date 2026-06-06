import { AsyncLocalStorage } from 'node:async_hooks';
import type { LifecycleScope } from '../conversations/lifecycle-scope.js';

/**
 * Node's AsyncLocalStorage is the analogue of .NET `AsyncLocal<T>` /
 * `ExecutionContext`: values flow with async continuations (`await`, native
 * promises). They do **not** cross arbitrary third-party timers unless those
 * timers were scheduled from within an active context (Node propagates ALS into
 * `setTimeout` callbacks scheduled while the store is active).
 *
 * We keep a **frame stack** (innermost last) so nested `spawn` / `run` branches
 * are visible and `getWorkScope()` always returns the innermost scope.
 */

export type WorkFrame = {
  scope: LifecycleScope;
  label: string;
};

const storage = new AsyncLocalStorage<WorkFrame[]>();

function currentStack(): WorkFrame[] {
  return storage.getStore() ?? [];
}

/** Full nesting stack, root → innermost. Empty outside any work context. */
export function getWorkFrameStack(): readonly WorkFrame[] {
  return currentStack();
}

/** Innermost active scope — like .NET AsyncLocal current value. */
export function getWorkScope(): LifecycleScope | undefined {
  return currentStack().at(-1)?.scope;
}

/** Dot path of nested branch labels, e.g. `conversation-run › thought-pipeline`. */
export function getWorkContextPath(): string | undefined {
  const stack = currentStack();
  if (stack.length === 0) return undefined;
  return stack.map((f) => f.label).join(' › ');
}

export function requireWorkScope(caller: string): LifecycleScope {
  const scope = getWorkScope();
  if (!scope) {
    throw new Error(`${caller}: requires an active WorkScope (use scope.spawn/run/delay)`);
  }
  return scope;
}

/** Enter a named frame; async continuations inherit until the returned work settles. */
export function runInWorkContext<T>(scope: LifecycleScope, label: string, fn: () => T): T {
  const stack = currentStack();
  return storage.run([...stack, { scope, label }], fn);
}

export async function runInWorkContextAsync<T>(
  scope: LifecycleScope,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const stack = currentStack();
  return storage.run([...stack, { scope, label }], fn);
}

/**
 * .NET `ExecutionContext.SuppressFlow()` — run without inheriting / exposing
 * the current work context (bootstrap, RxJS keepalives, raw-timer internals).
 */
export function runWithoutWorkContext<T>(fn: () => T): T {
  return storage.run([], fn);
}

/** @deprecated Use runWithoutWorkContext */
export const runUnscoped = runWithoutWorkContext;

export function isUnscoped(): boolean {
  return currentStack().length === 0;
}

/**
 * Bind a callback so it re-enters the current frame stack when invoked later
 * (event emitters, manual timer callbacks, streaming hooks).
 */
export function bindToWorkContext<T extends (...args: never[]) => unknown>(fn: T): T {
  const stack = currentStack();
  if (stack.length === 0) return fn;
  return ((...args: Parameters<T>) => storage.run(stack, () => fn(...args))) as T;
}

/** Snapshot frames at schedule time (timers, hooks) for later restore. */
export function snapshotWorkFrames(): WorkFrame[] {
  return [...currentStack()];
}

/** Run callback under a previously captured frame stack. */
export function runWithWorkFrames<T>(frames: readonly WorkFrame[], fn: () => T): T {
  if (frames.length === 0) return fn();
  return storage.run([...frames], fn);
}
