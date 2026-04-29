import { Injectable, MessageEvent } from '@nestjs/common';
import { from, interval, merge, Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type {
  AnySseEventEnvelope,
  SseEventEnvelope,
  SseEventPayloadByType,
  SseEventType,
} from '../contracts/sse.js';

export type SseHubEvent<TType extends SseEventType = SseEventType> = SseEventEnvelope<TType>;

@Injectable()
export class SseHubService {
  private seq = 0;
  private readonly bus = new Subject<AnySseEventEnvelope>();
  private readonly history: AnySseEventEnvelope[] = [];
  private readonly maxHistory = 1000;

  publish<TType extends SseEventType>(input: {
    conversationId: string;
    type: TType;
    payload: SseEventPayloadByType[TType];
  }): SseHubEvent<TType> {
    const event: SseHubEvent<TType> = {
      seq: ++this.seq,
      conversationId: input.conversationId,
      type: input.type,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };
    this.history.push(event);
    if (this.history.length > this.maxHistory) this.history.splice(0, this.history.length - this.maxHistory);
    this.bus.next(event);
    return event;
  }

  stream(input?: { conversationId?: string; afterSeq?: number }): Observable<MessageEvent> {
    const afterSeq = input?.afterSeq ?? 0;
    const conversationId = input?.conversationId;
    const inScope = (event: AnySseEventEnvelope): boolean =>
      conversationId ? event.conversationId === conversationId : true;

    const replay$ = from(this.history).pipe(
      filter((event) => event.seq > afterSeq),
      filter(inScope),
      map((event) => this.toMessageEvent(event)),
    );
    const live$ = this.bus.asObservable().pipe(
      filter(inScope),
      map((event) => this.toMessageEvent(event)),
    );
    const keepAlive$ = interval(15000).pipe(
      map((): MessageEvent => ({
        type: 'ka',
        data: {},
      })),
    );
    return merge(replay$, live$, keepAlive$);
  }

  private toMessageEvent(event: AnySseEventEnvelope): MessageEvent {
    return {
      id: String(event.seq),
      type: event.type,
      data: event,
    };
  }
}
