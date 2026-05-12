import { SseType, type SseEvent, type SseEventType } from "../../../backend3/src/contracts/sse.js";

const KNOWN_TYPES: ReadonlySet<SseEventType> = new Set(Object.values(SseType));

export function parseSseEventObject(raw: unknown): SseEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (typeof type !== "string" || !KNOWN_TYPES.has(type as SseEventType)) return null;
  if (typeof obj.conversationId !== "string") return null;
  if (typeof obj.seq !== "number" || !Number.isFinite(obj.seq)) return null;
  return raw as SseEvent;
}

export function parseSseEvent(data: string): SseEvent | null {
  return parseSseEventObject(JSON.parse(data));
}

export function isSseEvent(value: unknown): value is SseEvent {
  return parseSseEventObject(value) !== null;
}
