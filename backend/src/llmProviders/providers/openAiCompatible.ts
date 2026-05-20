import { Injectable, Logger } from '@nestjs/common';
import type {
  ConnectivityResult,
  LlmProvider,
  LlmProviderSettingSpec,
  ProviderSettingsDict,
} from '../provider.js';
import { StreamInterruptedError } from '../provider.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent, LlmUsage } from '../types.js';
import { OpenAiStreamAccumulator, buildOpenAiBody, ingestOpenAiChunk } from './openAiShared.js';

async function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  })
}

function normalizeBaseUrl(settings: ProviderSettingsDict): string {
  const raw = String(settings.base_url ?? '').trim();
  return raw.replace(/\/$/, '');
}

function apiKey(settings: ProviderSettingsDict): string {
  return String(settings.api_key ?? '').trim();
}

function usageFromOpenAiPayload(usage: unknown): LlmUsage | undefined {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return undefined;
  const rec = usage as Record<string, unknown>;
  const pt = rec.prompt_tokens;
  const ct = rec.completion_tokens;
  const promptDetails =
    rec.prompt_tokens_details &&
    typeof rec.prompt_tokens_details === 'object' &&
    !Array.isArray(rec.prompt_tokens_details)
      ? (rec.prompt_tokens_details as Record<string, unknown>)
      : null;
  const inputDetails =
    rec.input_tokens_details && typeof rec.input_tokens_details === 'object' && !Array.isArray(rec.input_tokens_details)
      ? (rec.input_tokens_details as Record<string, unknown>)
      : null;
  const cachedRaw = promptDetails?.cached_tokens ?? inputDetails?.cached_tokens;
  const cachedPromptTokens =
    typeof cachedRaw === 'number' && Number.isFinite(cachedRaw) ? Math.max(0, Math.trunc(cachedRaw)) : undefined;
  if (typeof pt === 'number' && Number.isFinite(pt) && typeof ct === 'number' && Number.isFinite(ct)) {
    return {
      promptTokens: pt,
      completionTokens: ct,
      ...(cachedPromptTokens !== undefined
        ? { cachedPromptTokens: Math.min(cachedPromptTokens, Math.max(0, Math.trunc(pt))) }
        : {}),
    };
  }
  const total = rec.total_tokens;
  if (typeof total === 'number' && Number.isFinite(total) && typeof pt === 'number' && Number.isFinite(pt)) {
    return {
      promptTokens: pt,
      completionTokens: Math.max(0, total - pt),
      ...(cachedPromptTokens !== undefined
        ? { cachedPromptTokens: Math.min(cachedPromptTokens, Math.max(0, Math.trunc(pt))) }
        : {}),
    };
  }
  return undefined;
}

const DEFAULT_SPEC: LlmProviderSettingSpec[] = [
  { key: 'api_key', label: 'API key', type: 'secret', required: true },
  { key: 'base_url', label: 'Base URL', type: 'url', required: true },
];

type OpenAiCompatibleProviderOptions = {
  requireApiKey?: boolean;
};

function parseModelIdentifier(rawModel: unknown, opts: { requireLlmType: boolean }): string {
  if (rawModel == null || typeof rawModel !== 'object') return '';
  const rec = rawModel as {
    id?: unknown;
    key?: unknown;
    type?: unknown;
    loaded_instances?: unknown;
  };
  if (opts.requireLlmType && typeof rec.type === 'string' && rec.type && rec.type !== 'llm') return '';
  if (typeof rec.id === 'string' && rec.id.trim()) return rec.id.trim();
  if (typeof rec.key === 'string' && rec.key.trim()) return rec.key.trim();
  if (Array.isArray(rec.loaded_instances) && rec.loaded_instances.length > 0) {
    const first = rec.loaded_instances[0];
    if (first != null && typeof first === 'object' && typeof (first as { id?: unknown }).id === 'string') {
      return String((first as { id: string }).id).trim();
    }
  }
  return '';
}

export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly requireApiKey: boolean;
  private readonly logger = new Logger(this.constructor.name);

  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly defaultBaseUrl: string,
    options: OpenAiCompatibleProviderOptions = {},
  ) {
    this.requireApiKey = options.requireApiKey ?? true;
  }

  getSettingsSpec(): LlmProviderSettingSpec[] {
    if (this.requireApiKey) return DEFAULT_SPEC;
    return DEFAULT_SPEC.map((spec) => (spec.key === 'api_key' ? { ...spec, required: false } : spec));
  }

  protected mergedSettings(settings: ProviderSettingsDict): ProviderSettingsDict {
    return { ...settings, base_url: String(settings.base_url ?? this.defaultBaseUrl) };
  }

  async checkConnectivity(settingsIn: ProviderSettingsDict): Promise<ConnectivityResult> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/models`;
    if (!baseUrl) return { ok: false, detail: 'base_url is required' };
    if (this.requireApiKey && !key) return { ok: false, detail: 'api_key is required' };
    try {
      const headers: Record<string, string> = {};
      if (key) headers.Authorization = `Bearer ${key}`;
      const res = await fetch(requestUrl, { method: 'GET', headers });
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
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/models`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(requestUrl, { method: 'GET', headers });
    if (!res.ok) throw new Error(`models fetch failed (${res.status})`);
    const raw = (await res.json()) as unknown;
    const openAiData =
      raw != null && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)
        ? (raw as { data: unknown[] }).data
        : [];
    const lmStudioData =
      raw != null && typeof raw === 'object' && Array.isArray((raw as { models?: unknown }).models)
        ? (raw as { models: unknown[] }).models
        : [];
    const models = [
      ...openAiData.map((x) => parseModelIdentifier(x, { requireLlmType: false })),
      ...lmStudioData.map((x) => parseModelIdentifier(x, { requireLlmType: true })),
    ].filter((x) => x.length > 0);
    return Array.from(new Set(models));
  }

  async streamCompletion(
    settingsIn: ProviderSettingsDict,
    model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<LlmCompletion> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/chat/completions`;
    if (!baseUrl) throw new Error('base_url is required');
    if (this.requireApiKey && !key) throw new Error('api_key is required');

    this.logger.log(
      { providerId: this.id, model, baseUrl, requestUrl, turns: request.messages.length },
      '[llm-provider] completion request sending',
    );
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildOpenAiBody(model, request)),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`llm request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const acc = new OpenAiStreamAccumulator(onEvent);

    // Some providers ignore `stream:true` and return a single JSON body.
    if (!res.body) {
      const data = (await res.json()) as Parameters<typeof ingestOpenAiChunk>[0];
      try {
        ingestOpenAiChunk(data, acc, usageFromOpenAiPayload);
      } catch (e) {
        throw new StreamInterruptedError({
          message: 'stream interrupted during callback',
          partialText: acc.partialText(),
          cause: e,
        });
      }
      if (!acc.hasContent()) throw new Error('llm returned empty response');
      return acc.finalize();
    }

    const decoder = new TextDecoder();
    let buffer = '';

    const handleDataLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
      if (!payload || payload === '[DONE]') return;
      const parsed = JSON.parse(payload) as Parameters<typeof ingestOpenAiChunk>[0];
      try {
        ingestOpenAiChunk(parsed, acc, usageFromOpenAiPayload);
      } catch (e) {
        throw new StreamInterruptedError({
          message: 'stream interrupted during callback',
          partialText: acc.partialText(),
          cause: e,
        });
      }
    };

    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      await sleep(1000);
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
    if (!acc.hasContent()) throw new Error('llm returned empty streamed response');
    return acc.finalize();
  }
}

@Injectable()
export class OpenAiProvider extends OpenAiCompatibleProvider {
  constructor() {
    super('openai', 'OpenAI', 'https://api.openai.com/v1');
  }
}

@Injectable()
export class GrokProvider extends OpenAiCompatibleProvider {
  constructor() {
    super('grok', 'Grok', 'https://api.x.ai/v1');
  }
}
