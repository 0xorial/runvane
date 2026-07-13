import type { LlmCompletion, LlmStreamEvent } from '../types.js';
import { abortableDelay } from './stubLlm.helpers.js';

export function tokenizeStubStream(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

export async function streamStubText(
  text: string,
  delayMs: number,
  onEvent: (event: LlmStreamEvent) => void,
  signal?: AbortSignal,
  costUsd?: number,
): Promise<LlmCompletion> {
  let acc = '';
  // Capture provider-style raw chunks like the real adapters do
  // (OpenAiStreamAccumulator): a STREAMED stub reply therefore yields
  // `llmResponse` = chunk-transport JSON and `assembledResponse` = the actual
  // text, so tests exercise the same raw/assembled split live providers
  // produce. Instant replies stay chunk-less, mirroring non-streamed calls.
  const rawChunks: unknown[] = [];
  for (const token of tokenizeStubStream(text)) {
    signal?.throwIfAborted();
    await abortableDelay(delayMs, signal);
    onEvent({ type: 'text_delta', delta: token });
    rawChunks.push({ choices: [{ delta: { content: token } }] });
    acc += token;
  }
  onEvent({ type: 'finish', reason: 'stop' });
  return {
    parts: [{ kind: 'text', text: acc }],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: acc.length, ...(costUsd !== undefined ? { costUsd } : {}) },
    ...(rawChunks.length > 0 ? { rawChunks } : {}),
  };
}

export function instantStubText(
  text: string,
  onEvent: (event: LlmStreamEvent) => void,
  costUsd?: number,
): LlmCompletion {
  onEvent({ type: 'text_delta', delta: text });
  onEvent({ type: 'finish', reason: 'stop' });
  return {
    parts: [{ kind: 'text', text }],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: text.length, ...(costUsd !== undefined ? { costUsd } : {}) },
  };
}
