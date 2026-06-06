import type { LlmProvider, ProviderSettingsDict } from '../provider.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../types.js';

function requestText(request: LlmRequest): string {
  return request.messages
    .flatMap((message) => message.parts)
    .filter((part) => part.kind === 'text')
    .map((part) => part.text)
    .join('\n');
}

function pickStubReply(request: LlmRequest): string {
  const blob = requestText(request);
  if (/title this conversation/i.test(blob)) return 'Time Inquiry';

  if (request.tools?.length) {
    return JSON.stringify({
      assistant_output: 'The current time is 12:00 UTC.',
      tool_requests: [],
      followup: 'finalize',
    });
  }

  if (/tool parameters|parameters for the/i.test(blob)) return '{}';

  return JSON.stringify({
    assistant_output: 'The current time is 12:00 UTC.',
    tool_requests: [],
    followup: 'finalize',
  });
}

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
