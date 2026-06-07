import type { LlmProvider, ProviderSettingsDict } from '../provider.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../types.js';
import {
  abortableDelay,
  parseStubDelayMs,
  pickStubReply,
  stubRequestText,
} from './stubLlm.helpers.js';

/** Instant deterministic LLM when LLM_TEST_STUB=1 (default for integration tests / dev:stub). */
export class StubLlmProvider implements LlmProvider {
  readonly id = 'stub';
  readonly label = 'Test stub';

  getSettingsSpec() {
    return [];
  }

  async checkConnectivity(_settings: ProviderSettingsDict) {
    return { ok: true as const, detail: null };
  }

  async listModels(_settings: ProviderSettingsDict) {
    return ['stub-model'];
  }

  async streamCompletion(
    _settings: ProviderSettingsDict,
    _model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletion> {
    signal?.throwIfAborted();
    const blob = stubRequestText(request);
    const delayMs = parseStubDelayMs(blob);
    if (delayMs !== null) await abortableDelay(delayMs, signal);
    signal?.throwIfAborted();
    const text = pickStubReply(request);
    onEvent({ type: 'text_delta', delta: text });
    onEvent({ type: 'finish', reason: 'stop' });
    return {
      parts: [{ kind: 'text', text }],
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: text.length },
    };
  }
}
