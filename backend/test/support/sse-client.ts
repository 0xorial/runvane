import type { SseEvent } from '../../src/contracts/sse';

export type SseCollector = {
  events: SseEvent[];
  stop: () => void;
  done: Promise<void>;
};

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

/** Collect global SSE while an async action runs (live backend integration). */
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
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { result, events };
  } finally {
    controller.abort();
    await readerTask.catch(() => undefined);
  }
}
