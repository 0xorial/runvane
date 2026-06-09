import { Injectable } from '@nestjs/common';
import type { LlmProvider, ProviderSettingsDict } from '../provider.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../types.js';
import type { StubLlmControl, StubModelScript } from './stubLlm.control.js';
import { StubLlmQueue } from './stubLlm.queue.js';
import {
  abortableDelay,
  parseStubDelayMs,
  pickStubReply,
  stubIsTitleGenerationRequest,
  stubIsToolParamsRequest,
  stubRequestText,
} from './stubLlm.helpers.js';
import { instantStubText, streamStubText } from './stubLlm.stream.js';
import { STUB_E2E_MODELS } from './stubLlm.models.js';

export type StubLlmOptions = {
  /** Default token delay when a queued response omits `streamMs`. */
  streamDelayMs?: number;
  models?: readonly string[];
};

@Injectable()
export class StubLlmProvider implements LlmProvider, StubLlmControl {
  readonly id = 'stub';
  readonly label = 'Test stub';

  private readonly defaultStreamMs: number | undefined;
  private readonly models: readonly string[];
  private readonly queue = new StubLlmQueue();

  constructor(opts: StubLlmOptions = {}) {
    this.defaultStreamMs = opts.streamDelayMs;
    this.models = opts.models ?? STUB_E2E_MODELS;
  }

  getSettingsSpec() {
    return [];
  }

  async checkConnectivity(_settings: ProviderSettingsDict) {
    return { ok: true as const, detail: null };
  }

  async listModels(_settings: ProviderSettingsDict) {
    return [...this.models];
  }

  configure(scripts: StubModelScript[], opts?: { append?: boolean }): void {
    this.queue.configure(scripts, opts?.append ?? false);
  }

  setNextResponse(text: string): void {
    this.queue.pushFallback(text);
  }

  setNextResponses(...texts: string[]): void {
    this.queue.pushFallbackMany(texts);
  }

  reset(): void {
    this.queue.reset();
  }

  pendingCount(): number {
    return this.queue.pendingCount();
  }

  async streamCompletion(
    _settings: ProviderSettingsDict,
    model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletion> {
    signal?.throwIfAborted();
    const blob = stubRequestText(request);
    const delayMs = parseStubDelayMs(blob);
    if (delayMs !== null) await abortableDelay(delayMs, signal);
    signal?.throwIfAborted();

    const instant = stubIsTitleGenerationRequest(blob) || stubIsToolParamsRequest(blob);
    const queued = instant ? this.queue.takeInstant() : this.queue.takeCompletion(model);
    const text = queued?.text ?? pickStubReply(request);
    const streamMs = queued?.streamMs ?? this.defaultStreamMs;
    if (instant || streamMs === undefined) {
      return instantStubText(text, onEvent);
    }
    return streamStubText(text, streamMs, onEvent, signal);
  }
}
