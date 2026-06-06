import { nativeTimers } from './async-entry-patches.js';
import { bindToWorkContext } from './work-context.js';

/** Low-level timer — uses native (unmonitored) schedulers to avoid double-counting scope timers. */
export function rawSetTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  return nativeTimers.setTimeout(bindToWorkContext(fn), ms);
}

export function rawClearTimeout(handle: ReturnType<typeof setTimeout>): void {
  nativeTimers.clearTimeout(handle);
}
