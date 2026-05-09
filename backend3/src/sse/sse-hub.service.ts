import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject, from, interval, merge } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type { SseEvent, SsePayload } from '../contracts/sse.js';

@Injectable()
export class SseHubService {
  private nextSeq = 1;
  private readonly bus = new Subject<SseEvent>();
  private readonly replay: SseEvent[] = [];
  private readonly replayMax = 256;

  publish(conversationId: string, payload: SsePayload): SseEvent {
    const event = { ...payload, conversationId, seq: this.nextSeq++ } as SseEvent;
    this.replay.push(event);
    if (this.replay.length > this.replayMax) {
      this.replay.splice(0, this.replay.length - this.replayMax);
    }
    this.bus.next(event);
    return event;
  }

  stream(input?: { conversationId?: string; afterSeq?: number }): Observable<MessageEvent> {
    const afterSeq = input?.afterSeq ?? 0;
    const conversationId = input?.conversationId;
    const inScope = (event: SseEvent): boolean =>
      conversationId ? event.conversationId === conversationId : true;

    const replay$ = from(this.replay).pipe(
      filter((event) => event.seq > afterSeq),
      filter(inScope),
      map((event) => this.toDefaultMessage(event)),
    );
    const live$ = this.bus.asObservable().pipe(
      filter(inScope),
      map((event) => this.toDefaultMessage(event)),
    );
    const keepAlive$ = interval(15000).pipe(
      map((): MessageEvent => ({ type: 'ka', data: '{}' })),
    );
    return merge(replay$, live$, keepAlive$);
  }

  private toDefaultMessage(event: SseEvent): MessageEvent {
    return { id: String(event.seq), data: event };
  }
}
