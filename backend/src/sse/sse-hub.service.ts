import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Observable, Subject, interval, merge } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type { SseEvent, SsePayload } from '../contracts/sse.js';
import { SsePayloadSchema } from '../contracts/sse.js';
import { StreamCursorService } from '../db/stream-cursor.service.js';

@Injectable()
export class SseHubService {
  private readonly logger = new Logger(SseHubService.name);
  private readonly bus = new Subject<SseEvent>();

  constructor(private readonly cursor: StreamCursorService) {}

  publish(conversationId: string, payload: SsePayload): SseEvent {
    const validation = SsePayloadSchema.safeParse(payload);
    if (!validation.success) {
      const details = validation.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      this.logger.error(
        `SSE payload validation failed (type=${payload.type}): ${details}\nPayload: ${JSON.stringify(payload)}`,
      );
    }
    const event = { ...payload, conversationId, seq: this.cursor.current() } as SseEvent;
    this.bus.next(event);
    return event;
  }

  /**
   * The seq of the last published event. A state snapshot read now reflects
   * every event up to this seq; the client resumes the live tail strictly
   * after it. This single watermark IS the snapshot↔stream handoff — there is
   * deliberately no replay buffer: recovery from any gap is a fresh snapshot.
   */
  /**
   * Latest live-stream seq (the cursor mirror). Snapshots read the DB cursor
   * directly inside their read txn for an exact watermark; this is only for
   * stamping live events.
   */
  currentSeq(): number {
    return this.cursor.current();
  }

  /**
   * Live event tail — purely "from now on". Each message carries its seq as the
   * SSE `id` so the client can order/dedup and pair it with a snapshot watermark.
   */
  stream(input?: { conversationId?: string }): Observable<MessageEvent> {
    const conversationId = input?.conversationId;
    const inScope = (event: SseEvent): boolean =>
      conversationId ? event.conversationId === conversationId : true;

    const live$ = this.bus.asObservable().pipe(
      filter(inScope),
      map((event) => this.toDefaultMessage(event)),
    );
    const keepAlive$ = interval(15000).pipe(
      map((): MessageEvent => ({ type: 'ka', data: '{}' })),
    );
    return merge(live$, keepAlive$);
  }

  private toDefaultMessage(event: SseEvent): MessageEvent {
    return { id: String(event.seq), data: event };
  }
}
