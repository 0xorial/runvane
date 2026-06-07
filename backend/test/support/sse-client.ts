import { SseType, type SseEvent } from '../../src/contracts/sse';
import { STUB_PROBE_TIME_REPLY } from '../../src/llmProviders/providers/stubLlm.helpers.js';
import { integrationUsesLiveLlm, sleep } from './http';

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

function probeSseUpserts(events: SseEvent[]): Array<{ type?: string; text?: string }> {
  return events
    .filter((ev) => ev.type === SseType.CHAT_ENTRY_UPSERT)
    .map((ev) => ev.entry as { type?: string; text?: string });
}

function isProbeSseComplete(events: SseEvent[]): boolean {
  const upserts = probeSseUpserts(events);
  const hasTool = upserts.some((entry) => entry.type === 'tool-invocation');
  const hasFinalAssistant = upserts.some((entry) => {
    if (entry.type !== 'assistant-message') return false;
    const text = String(entry.text || '').trim();
    if (!text) return false;
    return integrationUsesLiveLlm() ? true : text.includes(STUB_PROBE_TIME_REPLY);
  });
  return hasTool && hasFinalAssistant;
}

async function waitForProbeSse(events: SseEvent[], deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (isProbeSseComplete(events)) return;
    await sleep(5);
  }
  throw new Error(`SSE: probe flow incomplete within ${deadlineMs}ms (${events.length} events collected)`);
}

/** Collect global SSE while an async action runs. */
export async function collectSseDuring<T>(
  baseUrl: string,
  conversationId: string,
  run: () => Promise<T>,
): Promise<{ result: T; events: SseEvent[] }> {
  const events: SseEvent[] = [];
  const controller = new AbortController();
  let sseConnected = false;
  const readerTask = (async () => {
    const res = await fetch(`${baseUrl}/api/stream`, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`SSE connect failed: ${res.status}`);
    sseConnected = true;
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
    const connectDeadline = Date.now() + 2_000;
    while (!sseConnected && Date.now() < connectDeadline) {
      await sleep(5);
    }
    if (!sseConnected) throw new Error('SSE: connection not established before probe run');

    const result = await run();
    await waitForProbeSse(events, 2_000);
    return { result, events };
  } finally {
    controller.abort();
    await readerTask.catch(() => undefined);
  }
}
