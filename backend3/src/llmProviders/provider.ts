import type { LlmCompletion, LlmRequest, LlmStreamEvent, LlmUsage } from './types.js';

export type ProviderSettingsDict = Record<string, unknown>;

export type LlmProviderSettingSpec = {
  key: string;
  label: string;
  type: 'string' | 'secret' | 'url';
  required: boolean;
  placeholder?: string;
};

export type ConnectivityResult = {
  ok: boolean;
  detail: string | null;
};

/** Re-exported for convenience; usage shape lives in types.ts. */
export type { LlmUsage as StreamTextCompletionUsage } from './types.js';

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
  ): Promise<LlmCompletion>;
}
