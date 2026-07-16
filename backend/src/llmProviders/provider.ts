import { z } from 'zod';
import type { LlmCompletion, LlmRequest, LlmStreamEvent, LlmUsage } from './types.js';

export type ProviderSettingsDict = Record<string, unknown>;

export const LlmProviderSettingSpecSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.union([z.literal('string'), z.literal('secret'), z.literal('url')]),
  required: z.boolean(),
  placeholder: z.string().optional(),
});
export type LlmProviderSettingSpec = z.infer<typeof LlmProviderSettingSpecSchema>;

export const ConnectivityResultSchema = z.object({
  ok: z.boolean(),
  detail: z.string().nullable(),
});
export type ConnectivityResult = z.infer<typeof ConnectivityResultSchema>;

/** Per-model catalog pricing in USD per 1M tokens — the same shape the
 *  frontend's capability-derived `ModelPricing` uses, so live provider
 *  pricing can back-fill models the capability table leaves unpriced. */
export type ModelPricingPer1M = {
  inCostPer1m: number;
  cachedInCostPer1m: number;
  outCostPer1m: number;
};

/** One model surfaced by discovery, with catalog pricing where the provider
 *  publishes it alongside the model list. */
export type DiscoveredModel = {
  name: string;
  pricing?: ModelPricingPer1M;
};

/** Re-exported for convenience; usage shape lives in types.ts. */
export type { LlmUsage as StreamTextCompletionUsage } from './types.js';

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    error.name === 'AbortError'
  );
}

export class StreamInterruptedError extends Error {
  readonly partialText: string;
  readonly usage?: LlmUsage;
  readonly cause?: unknown;

  constructor(input: { message: string; partialText: string; usage?: LlmUsage; cause?: unknown }) {
    super(input.message);
    this.name = 'StreamInterruptedError';
    this.partialText = input.partialText;
    this.usage = input.usage;
    this.cause = input.cause;
  }
}

export interface LlmProvider {
  readonly id: string;
  readonly label: string;

  getSettingsSpec(): LlmProviderSettingSpec[];
  checkConnectivity(settings: ProviderSettingsDict): Promise<ConnectivityResult>;
  listModels(settings: ProviderSettingsDict): Promise<string[]>;

  /**
   * Streams a completion. The promise resolves to the fully-accumulated
   * `LlmCompletion` (parts, finishReason, usage). `onEvent` is called as
   * deltas arrive; consumers may ignore it and rely on the resolved promise.
   *
   * `model` is passed separately because it is resolved at the LLM-config
   * layer (not part of the prompt) and stamped onto the wire body by the
   * adapter.
   */
  streamCompletion(
    settings: ProviderSettingsDict,
    model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletion>;

  /**
   * Optional: embed a batch of texts, returning one vector per input in the
   * same order. Not every provider supports embeddings (e.g. routing-only
   * backends), so this is optional — callers check for its presence and
   * surface a clear error when a chosen provider can't embed.
   */
  embedTexts?(
    settings: ProviderSettingsDict,
    model: string,
    texts: string[],
    signal?: AbortSignal,
  ): Promise<number[][]>;

  /**
   * Optional: live per-model pricing from the provider's catalog, keyed by
   * model name. Providers that don't publish pricing (self-hosted backends)
   * simply omit this; the composer's cost estimate falls back to capability
   * overrides only.
   */
  listModelPricing?(settings: ProviderSettingsDict): Promise<Record<string, ModelPricingPer1M>>;

  /**
   * Optional richer discovery: the model list WITH catalog pricing where the
   * provider publishes it. Used by the verify flow to persist pricing next to
   * `models_json`, so discovered capability rows stop being unpriced.
   * Providers without pricing keep implementing `listModels` only.
   */
  discoverModels?(settings: ProviderSettingsDict): Promise<DiscoveredModel[]>;
}
