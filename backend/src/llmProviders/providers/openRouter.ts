import { Injectable, Logger } from '@nestjs/common';
import type {
  ConnectivityResult,
  LlmProvider,
  LlmProviderSettingSpec,
  ProviderSettingsDict,
} from '../provider.js';
import { StreamInterruptedError, isAbortError } from '../provider.js';
import type { LlmUsage } from '../types.js';
import {
  fetchOpenRouterGenerationUsage,
  mergeLlmUsage,
} from './openRouterGeneration.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../types.js';
import {
  OpenAiStreamAccumulator,
  buildOpenRouterBody,
  fetchLlm,
  ingestOpenAiChunk,
  parseChatCompletionsUsage,
} from './openAiShared.js';

const SETTINGS_SPEC: LlmProviderSettingSpec[] = [
  { key: 'api_key', label: 'API key', type: 'secret', required: true },
  { key: 'base_url', label: 'Base URL', type: 'url', required: true },
  { key: 'http_referer', label: 'HTTP Referer', type: 'url', required: false },
  { key: 'x_title', label: 'X-Title', type: 'string', required: false },
];

function normalizeBaseUrl(settings: ProviderSettingsDict, defaultBaseUrl: string): string {
  const raw = String(settings.base_url ?? defaultBaseUrl).trim();
  return raw.replace(/\/$/, '');
}

function apiKey(settings: ProviderSettingsDict): string {
  return String(settings.api_key ?? '').trim();
}

function buildHeaders(settings: ProviderSettingsDict): Record<string, string> {
  const key = apiKey(settings);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const referer = String(settings.http_referer ?? '').trim();
  const title = String(settings.x_title ?? '').trim();
  if (referer) headers['HTTP-Referer'] = referer;
  if (title) headers['X-Title'] = title;
  return headers;
}

function parseModelIdentifier(rawModel: unknown): string {
  if (rawModel == null || typeof rawModel !== 'object') return '';
  const rec = rawModel as { id?: unknown };
  return typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : '';
}

@Injectable()
export class OpenRouterProvider implements LlmProvider {
  public readonly id = 'openrouter';
  public readonly label = 'OpenRouter';
  private readonly defaultBaseUrl = 'https://openrouter.ai/api/v1';
  private readonly logger = new Logger(OpenRouterProvider.name);

  getSettingsSpec(): LlmProviderSettingSpec[] {
    return SETTINGS_SPEC;
  }

  private mergedSettings(settings: ProviderSettingsDict): ProviderSettingsDict {
    return { ...settings, base_url: String(settings.base_url ?? this.defaultBaseUrl) };
  }

  private async fetchModelsPayload(settingsIn: ProviderSettingsDict): Promise<unknown[]> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/models`;
    if (!baseUrl) throw new Error('base_url is required');
    if (!key) throw new Error('api_key is required');
    const res = await fetch(requestUrl, { method: 'GET', headers: buildHeaders(settings) });
    if (!res.ok) throw new Error(`models fetch failed (${res.status})`);
    const raw = (await res.json()) as unknown;
    return raw != null && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)
      ? (raw as { data: unknown[] }).data
      : [];
  }

  async checkConnectivity(settingsIn: ProviderSettingsDict): Promise<ConnectivityResult> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/models`;
    if (!baseUrl) return { ok: false, detail: 'base_url is required' };
    if (!key) return { ok: false, detail: 'api_key is required' };
    try {
      const res = await fetch(requestUrl, { method: 'GET', headers: buildHeaders(settings) });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, detail: `connectivity failed (${res.status}): ${body.slice(0, 300)}` };
      }
      return { ok: true, detail: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, detail: `connectivity failed: ${msg}` };
    }
  }

  async listModels(settingsIn: ProviderSettingsDict): Promise<string[]> {
    const data = await this.fetchModelsPayload(settingsIn);
    return Array.from(new Set(data.map(parseModelIdentifier).filter((x) => x.length > 0)));
  }

  listModelCapabilitiesFromPayload(payload: unknown[]): Array<{
    model_name: string;
    supports_image_input: boolean;
    supports_file_input: boolean;
    max_context_tokens: number | null;
    max_output_tokens: number | null;
    input_cost_per_1m: number | null;
    cached_input_cost_per_1m: number | null;
    output_cost_per_1m: number | null;
    currency: string;
  }> {
    const parseUsdPerTokenToPer1M = (raw: unknown): number | null => {
      if (typeof raw !== 'string') return null;
      const n = Number(raw.trim());
      if (!Number.isFinite(n)) return null;
      return n * 1_000_000;
    };

    return payload
      .map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const rec = raw as Record<string, unknown>;
        const model_name = parseModelIdentifier(raw);
        if (!model_name) return null;
        const architecture =
          rec.architecture && typeof rec.architecture === 'object' && !Array.isArray(rec.architecture)
            ? (rec.architecture as Record<string, unknown>)
            : {};
        const inputModalities = Array.isArray(architecture.input_modalities)
          ? architecture.input_modalities
              .map((x) => String(x || '').trim().toLowerCase())
              .filter((x) => x.length > 0)
          : [];
        const supports_image_input = inputModalities.includes('image');
        const supports_file_input = inputModalities.includes('file');
        const contextRaw = rec.context_length;
        const max_context_tokens =
          typeof contextRaw === 'number' && Number.isFinite(contextRaw) ? Math.trunc(contextRaw) : null;
        const topProvider =
          rec.top_provider && typeof rec.top_provider === 'object' && !Array.isArray(rec.top_provider)
            ? (rec.top_provider as Record<string, unknown>)
            : {};
        const maxOutputRaw = topProvider.max_completion_tokens;
        const max_output_tokens =
          typeof maxOutputRaw === 'number' && Number.isFinite(maxOutputRaw) ? Math.trunc(maxOutputRaw) : null;
        const pricing =
          rec.pricing && typeof rec.pricing === 'object' && !Array.isArray(rec.pricing)
            ? (rec.pricing as Record<string, unknown>)
            : {};
        const input_cost_per_1m = parseUsdPerTokenToPer1M(pricing.prompt);
        const cached_input_cost_per_1m = parseUsdPerTokenToPer1M(pricing.input_cache_read);
        const output_cost_per_1m = parseUsdPerTokenToPer1M(pricing.completion);
        return {
          model_name,
          supports_image_input,
          supports_file_input,
          max_context_tokens,
          max_output_tokens,
          input_cost_per_1m,
          cached_input_cost_per_1m,
          output_cost_per_1m,
          currency: 'USD',
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  async listModelCapabilities(settingsIn: ProviderSettingsDict): Promise<
    Array<{
      model_name: string;
      supports_image_input: boolean;
      supports_file_input: boolean;
      max_context_tokens: number | null;
      max_output_tokens: number | null;
      input_cost_per_1m: number | null;
      cached_input_cost_per_1m: number | null;
      output_cost_per_1m: number | null;
      currency: string;
    }>
  > {
    const payload = await this.fetchModelsPayload(settingsIn);
    return this.listModelCapabilitiesFromPayload(payload);
  }

  private async resolveAbortedUsage(
    settings: ProviderSettingsDict,
    acc: OpenAiStreamAccumulator,
  ): Promise<LlmUsage | undefined> {
    const generationId = acc.generationIdValue();
    const partial = acc.usageValue();
    if (!generationId) return partial;
    try {
      const fromApi = await fetchOpenRouterGenerationUsage(
        settings,
        generationId,
        this.defaultBaseUrl,
        buildHeaders,
        normalizeBaseUrl,
      );
      return mergeLlmUsage(fromApi, partial);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        { generationId, detail: msg },
        '[llm-provider] openrouter generation usage fetch failed on abort',
      );
      return partial;
    }
  }

  async streamCompletion(
    settingsIn: ProviderSettingsDict,
    model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletion> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    const requestUrl = `${baseUrl}/chat/completions`;
    const key = apiKey(settings);
    if (!baseUrl) throw new Error('base_url is required');
    if (!key) throw new Error('api_key is required');

    this.logger.log(
      { providerId: this.id, model, baseUrl, requestUrl, turns: request.messages.length },
      '[llm-provider] openrouter completion request sending',
    );
    const res = await fetchLlm(requestUrl, {
      method: 'POST',
      headers: buildHeaders(settings),
      body: JSON.stringify(buildOpenRouterBody(model, request)),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`llm request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const acc = new OpenAiStreamAccumulator(onEvent);

    try {
      if (!res.body) {
        const data = (await res.json()) as Parameters<typeof ingestOpenAiChunk>[0];
        try {
          ingestOpenAiChunk(data, acc, parseChatCompletionsUsage);
        } catch (e) {
          throw new StreamInterruptedError({
            message: 'stream interrupted during callback',
            partialText: acc.partialText(),
            usage: acc.usageValue(),
            cause: e,
          });
        }
        // An empty completion (e.g. Anthropic end_turn with no content/tool
        // calls) is a valid, if unhelpful, outcome — not a transport error.
        // Return it so callers finalize gracefully instead of failing the turn.
        if (!acc.hasContent()) this.logger.warn('llm returned empty completion — finalizing as no-op');
        return acc.finalize();
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const handleDataLine = (line: string): void => {
        if (!line.startsWith('data:')) return;
        const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
        if (!payload || payload === '[DONE]') return;
        const parsed = JSON.parse(payload) as Parameters<typeof ingestOpenAiChunk>[0];
        try {
          ingestOpenAiChunk(parsed, acc, parseChatCompletionsUsage);
        } catch (e) {
          throw new StreamInterruptedError({
            message: 'stream interrupted during callback',
            partialText: acc.partialText(),
            usage: acc.usageValue(),
            cause: e,
          });
        }
      };

      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        while (true) {
          const nl = buffer.indexOf('\n');
          if (nl < 0) break;
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          handleDataLine(line);
        }
      }
      if (buffer) handleDataLine(buffer.replace(/\r$/, ''));
      // See note above: an empty streamed completion is non-fatal.
      if (!acc.hasContent()) this.logger.warn('llm returned empty streamed completion — finalizing as no-op');
      return acc.finalize();
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        const usage = await this.resolveAbortedUsage(settings, acc);
        throw new StreamInterruptedError({
          message: 'stream aborted',
          partialText: acc.partialText(),
          usage,
          cause: error,
        });
      }
      throw error;
    }
  }
}
