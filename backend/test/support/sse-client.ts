import { SseType, type SseEvent } from '../../src/contracts/sse';
import { sleep } from './http';

function parseSseChunk(chunk: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of chunk.split('\n\n')) {
    const dataLine = block
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const raw = dataLine.slice('data:'.length).trim();
    if (!raw) continue;
    events.push(JSON.parse(raw) as SseEvent);
  }
  return events;
}

function hasAssistantUpsert(events: SseEvent[]): boolean {
  return events.some((ev) => {
    if (ev.type !== SseType.CHAT_ENTRY_UPSERT) return false;
    const entry = ev.entry as { type?: string; text?: string };
    return entry.type === 'assistant-message' && String(entry.text || '').trim().length > 0;
  });
}

async function waitForSseAssistant(events: SseEvent[], deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (hasAssistantUpsert(events)) return;
    await sleep(5);
  }
  throw new Error(`SSE: no assistant upsert within ${deadlineMs}ms (${events.length} events collected)`);
}

/** Collect global SSE while an async action runs. */
export async function collectSseDuring<T>(
  baseUrl: string,
  conversationId: string,
  run: () => Promise<T>,
): Promise<{ result: T; events: SseEvent[] }> {
  const events: SseEvent[] = [];
  const controller = new AbortController();
  const readerTask = (async () => {
    const res = await fetch(`${baseUrl}/api/stream`, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        for (const ev of parseSseChunk(`${part}\n\n`)) {
          if (ev.conversationId === conversationId) events.push(ev);
        }
      }
    }
  })();

  try {
    const result = await run();
    await waitForSseAssistant(events, 2_000);
    return { result, events };
  } finally {
    controller.abort();
    await readerTask.catch(() => undefined);
  }
}
