import type { LlmProvider, ProviderSettingsDict } from '../provider.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../types.js';
import {
  abortableDelay,
  parseStubDelayMs,
  pickStubReply,
  stubIsTitleGenerationRequest,
  stubIsToolParamsRequest,
  stubRequestText,
} from './stubLlm.helpers.js';
import { DEMO_MODELS, demoPlannerReply, demoTitle } from './stubLlm.demo.js';

export type StubLlmOptions = {
  demo?: boolean;
  demoDelayMs?: number;
};

/** Instant deterministic LLM when runtime.llm.mode === 'stub'. */
export class StubLlmProvider implements LlmProvider {
  readonly id = 'stub';
  readonly label = 'Test stub';

  private readonly demo: boolean;
  private readonly demoDelayMs: number;

  constructor(opts: StubLlmOptions = {}) {
    this.demo = opts.demo ?? false;
    this.demoDelayMs = opts.demoDelayMs ?? 45;
  }

  getSettingsSpec() {
    return [];
  }

  async checkConnectivity(_settings: ProviderSettingsDict) {
    return { ok: true as const, detail: null };
  }

  async listModels(_settings: ProviderSettingsDict) {
    return this.demo ? [...DEMO_MODELS] : ['stub-model'];
  }

  async streamCompletion(
    _settings: ProviderSettingsDict,
    model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletion> {
    signal?.throwIfAborted();
    if (this.demo) return this.streamDemo(model, request, onEvent, signal);

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

  private async streamDemo(
    model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletion> {
    const blob = stubRequestText(request);

    if (stubIsTitleGenerationRequest(blob)) return this.instant(demoTitle(request), onEvent);
    if (stubIsToolParamsRequest(blob)) return this.instant('{}', onEvent);

    const text = demoPlannerReply(request, model);
    const tokens = text.match(/\S+\s*|\s+/g) ?? [text];
    let acc = '';
    for (const token of tokens) {
      signal?.throwIfAborted();
      await abortableDelay(this.demoDelayMs, signal);
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

  private instant(text: string, onEvent: (event: LlmStreamEvent) => void): LlmCompletion {
    onEvent({ type: 'text_delta', delta: text });
    onEvent({ type: 'finish', reason: 'stop' });
    return {
      parts: [{ kind: 'text', text }],
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: text.length },
    };
  }
}
