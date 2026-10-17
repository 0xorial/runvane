import { Injectable, Logger } from '@nestjs/common';
import Anthropic, { APIError } from '@anthropic-ai/sdk';
import type {
  MessageCreateParamsStreaming,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { ConnectivityResult, LlmProvider, LlmProviderSettingSpec, ProviderSettingsDict } from '../provider.js';
import { StreamInterruptedError, isAbortError } from '../provider.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../types.js';
import { buildAnthropicBody, ingestAnthropicEvent, newStreamState } from './anthropicShared.js';
import { OpenAiStreamAccumulator, describeFetchCause } from './openAiShared.js';

/**
 * Native Anthropic Messages API (API key, Claude Console billing). This is the
 * path that spends a Console organization's credit balance — including the
 * monthly API credits bundled with Max/Team plans — with prompt caching and
 * structured outputs, which the OpenAI-compatibility endpoint lacks.
 *
 * No embeddings: Anthropic serves none, so `embedTexts` is deliberately absent.
 */

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

const SETTINGS_SPEC: LlmProviderSettingSpec[] = [
  { key: 'api_key', label: 'API key', type: 'secret', required: true },
  { key: 'base_url', label: 'Base URL', type: 'url', required: true, placeholder: ANTHROPIC_DEFAULT_BASE_URL },
];

/** The subset of the SDK client the provider uses; specs substitute a fake through {@link AnthropicProvider.createClient}. */
export type AnthropicClientLike = {
  messages: {
    create(
      body: MessageCreateParamsStreaming,
      options?: { signal?: AbortSignal | null },
    ): Promise<AsyncIterable<RawMessageStreamEvent>>;
  };
  models: {
    list(params?: { limit?: number }): AsyncIterable<{ id: string; lifecycle?: string }>;
  };
};

/** The SDK appends `/v1/...` itself; tolerate a pasted `.../v1` and trailing slashes. */
export function normalizeAnthropicBaseUrl(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const base = (trimmed || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, '');
  return base.replace(/\/v1$/, '');
}

function apiKey(settings: ProviderSettingsDict): string {
  const key = settings.api_key;
  return typeof key === 'string' ? key.trim() : '';
}

/** The API's own `error.message` from the JSON body (`APIError.message` prefixes the status and the whole body). */
function apiBodyMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const inner = (body as { error?: unknown }).error;
  if (!inner || typeof inner !== 'object') return undefined;
  const message = (inner as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : undefined;
}

/** One line for the UI: HTTP status + API message, or the connection-level cause. */
export function describeAnthropicError(error: unknown): string {
  if (error instanceof APIError) {
    const status: unknown = error.status;
    if (typeof status === 'number') {
      return `(${status}): ${(apiBodyMessage(error.error) ?? error.message).slice(0, 300)}`;
    }
  }
  return describeFetchCause(error);
}

@Injectable()
export class AnthropicProvider implements LlmProvider {
  public readonly id = 'anthropic';
  public readonly label = 'Anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);

  getSettingsSpec(): LlmProviderSettingSpec[] {
    return SETTINGS_SPEC;
  }

  /** Seam for tests; production builds the real SDK client. */
  protected createClient(settings: ProviderSettingsDict): AnthropicClientLike {
    return new Anthropic({
      apiKey: apiKey(settings),
      baseURL: normalizeAnthropicBaseUrl(settings.base_url),
      maxRetries: 2,
    });
  }

  async checkConnectivity(settings: ProviderSettingsDict): Promise<ConnectivityResult> {
    if (!apiKey(settings)) return { ok: false, detail: 'api_key is required' };
    try {
      const client = this.createClient(settings);
      await client.models.list({ limit: 1 })[Symbol.asyncIterator]().next();
      return { ok: true, detail: null };
    } catch (e) {
      return { ok: false, detail: `connectivity failed ${describeAnthropicError(e)}` };
    }
  }

  /** Every model the org can call; retired ids are left out because they 404. */
  async listModels(settings: ProviderSettingsDict): Promise<string[]> {
    if (!apiKey(settings)) throw new Error('api_key is required');
    const client = this.createClient(settings);
    const ids: string[] = [];
    for await (const model of client.models.list()) {
      if (model.lifecycle === 'retired') continue;
      const id = String(model.id ?? '').trim();
      if (id) ids.push(id);
    }
    return Array.from(new Set(ids));
  }

  async streamCompletion(
    settings: ProviderSettingsDict,
    model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletion> {
    if (!apiKey(settings)) throw new Error('api_key is required');
    const client = this.createClient(settings);
    const body = buildAnthropicBody(model, request);
    this.logger.log(
      {
        providerId: this.id,
        model,
        baseUrl: normalizeAnthropicBaseUrl(settings.base_url),
        turns: body.messages.length,
        tools: body.tools?.length ?? 0,
      },
      '[llm-provider] anthropic completion request sending',
    );

    const acc = new OpenAiStreamAccumulator(onEvent);
    const state = newStreamState();
    try {
      const stream = await client.messages.create(body, { signal });
      for await (const event of stream) {
        try {
          ingestAnthropicEvent(event, acc, state);
        } catch (e) {
          throw new StreamInterruptedError({
            message: 'stream interrupted during callback',
            partialText: acc.partialText(),
            usage: acc.usageValue(),
            cause: e,
          });
        }
      }
      // An empty completion (e.g. end_turn with no content) is a valid, if
      // unhelpful, outcome — not a transport error; callers finalize it.
      if (!acc.hasContent()) this.logger.warn('llm returned empty streamed completion — finalizing as no-op');
      return acc.finalize();
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw new StreamInterruptedError({
          message: 'stream aborted',
          partialText: acc.partialText(),
          usage: acc.usageValue(),
          cause: error,
        });
      }
      if (error instanceof StreamInterruptedError) throw error;
      if (error instanceof APIError) {
        throw new Error(`llm request failed ${describeAnthropicError(error)}`, { cause: error });
      }
      throw error;
    }
  }
}
