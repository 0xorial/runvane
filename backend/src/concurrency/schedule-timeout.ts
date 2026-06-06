import type { LifecycleScope } from '../conversations/lifecycle-scope.js';
import { getWorkScope, requireWorkScope } from './work-context.js';

export type ScheduledHandle = { clear(): void };

/**
 * Schedule a one-shot callback on the active WorkScope's timer registry.
 * Prefer this over raw `setTimeout` from tools and providers.
 */
export function scheduleTimeout(label: string, ms: number, fn: () => void): ScheduledHandle {
  return requireWorkScope(`scheduleTimeout(${label})`).scheduleTimeout(label, ms, fn);
}

/** Promise-based delay tied to scope abort. */
export function delayMs(label: string, ms: number, scope?: LifecycleScope): Promise<void> {
  const active = scope ?? getWorkScope();
  if (!active) {
    throw new Error(`delayMs(${label}): requires an active WorkScope`);
  }
  return active.delay(label, ms);
}
