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
): Promise<LlmCompletion> {
  let acc = '';
  for (const token of tokenizeStubStream(text)) {
    signal?.throwIfAborted();
    await abortableDelay(delayMs, signal);
    onEvent({ type: 'text_delta', delta: token });
    acc += token;
  }
  onEvent({ type: 'finish', reason: 'stop' });
  return {
    parts: [{ kind: 'text', text: acc }],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: acc.length },
  };
}

export function instantStubText(text: string, onEvent: (event: LlmStreamEvent) => void): LlmCompletion {
  onEvent({ type: 'text_delta', delta: text });
  onEvent({ type: 'finish', reason: 'stop' });
  return {
    parts: [{ kind: 'text', text }],
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: text.length },
  };
}
