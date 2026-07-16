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
import { hashEmbedding } from './stubLlm.embeddings.js';

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

  /** Fixed catalog pricing so the composer's cost estimate is exercisable in
   *  e2e without a live provider ($2 in / $1 cached / $10 out per 1M).
   *  'stub' is included on top of the picker models — the e2e seed's agents
   *  run with model_name 'stub'. */
  async listModelPricing(_settings: ProviderSettingsDict) {
    const priced = new Set([...this.models, 'stub']);
    return Object.fromEntries(
      [...priced].map((model) => [model, { inCostPer1m: 2, cachedInCostPer1m: 1, outCostPer1m: 10 }]),
    );
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
    const streamMs = queued?.streamMs ?? (instant ? undefined : this.defaultStreamMs);
    if (streamMs === undefined) {
      return instantStubText(text, onEvent, queued?.costUsd);
    }
    return streamStubText(text, streamMs, onEvent, signal, queued?.costUsd);
  }

  async embedTexts(
    _settings: ProviderSettingsDict,
    _model: string,
    texts: string[],
  ): Promise<number[][]> {
    return texts.map((text) => hashEmbedding(text));
  }
}
