import { type MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { nativeTimers } from '../concurrency/async-entry-patches.js';

/** SSE comment keepalive — uses native timers so infra heartbeats don't clutter work monitor. */
export function sseKeepAlive$(periodMs = 15000): Observable<MessageEvent> {
  return new Observable((subscriber) => {
    const handle = nativeTimers.setInterval(() => {
      subscriber.next({ type: 'ka', data: '{}' } satisfies MessageEvent);
    }, periodMs);
    return () => nativeTimers.clearInterval(handle);
  });
}
