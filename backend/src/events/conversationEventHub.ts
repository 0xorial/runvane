import type { SseEvent, SsePayload } from "../types/sse.js";

type EventListener = (ev: SseEvent) => void;

export class ConversationEventHub {
  private readonly listeners = new Set<EventListener>();
  private readonly replay: SseEvent[] = [];
  private nextSeq = 1;

  constructor(private readonly replayMax = 256) {}

  publish(conversationId: string | null, payload: SsePayload): void {
    if (!conversationId) return;
    const ev: SseEvent = {
      ...payload,
      conversation_id: conversationId,
      seq: this.nextSeq++,
    };
    this.replay.push(ev);
    if (this.replay.length > this.replayMax) {
      this.replay.splice(0, this.replay.length - this.replayMax);
    }

    for (const fn of this.listeners) fn(ev);
  }

  /**
   * Replay-first stream model:
   * 1) attach listener
   * 2) emit buffered events newer than `afterSeq` (if provided)
   * 3) continue with live events via the attached listener
   */
  subscribe(
    listener: EventListener,
    opts?: { replay?: boolean; afterSeq?: number | null },
  ): () => void {
    this.listeners.add(listener);

    if (opts?.replay) {
      const afterSeq =
        typeof opts.afterSeq === "number" && Number.isFinite(opts.afterSeq)
          ? Math.trunc(opts.afterSeq)
          : null;
      const buffered = [...this.replay];
      for (const ev of buffered) {
        if (afterSeq != null && ev.seq <= afterSeq) {
          continue;
        }
        listener(ev);
      }
    }

    return () => {
      this.listeners.delete(listener);
    };
  }
}
