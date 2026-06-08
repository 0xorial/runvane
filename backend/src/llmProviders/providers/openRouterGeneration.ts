import type { ProviderSettingsDict } from '../provider.js';
import type { LlmUsage } from '../types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function finiteTokenCount(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : undefined;
}

function finiteUsd(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

export function parseOpenRouterGenerationData(data: unknown): LlmUsage | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const rec = data as Record<string, unknown>;
  const promptTokens =
    finiteTokenCount(rec.tokens_prompt) ?? finiteTokenCount(rec.native_tokens_prompt);
  const completionTokens =
    finiteTokenCount(rec.tokens_completion) ?? finiteTokenCount(rec.native_tokens_completion);
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  const cachedPromptTokens = finiteTokenCount(rec.native_tokens_cached);
  const costUsd = finiteUsd(rec.total_cost) ?? finiteUsd(rec.usage);
  return {
    promptTokens,
    completionTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

export async function fetchOpenRouterGenerationUsage(
  settings: ProviderSettingsDict,
  generationId: string,
  defaultBaseUrl: string,
  buildHeaders: (settings: ProviderSettingsDict) => Record<string, string>,
  normalizeBaseUrl: (settings: ProviderSettingsDict, fallback: string) => string,
): Promise<LlmUsage | undefined> {
  const id = generationId.trim();
  if (!id) return undefined;
  const baseUrl = normalizeBaseUrl(settings, defaultBaseUrl);
  const requestUrl = `${baseUrl}/generation?id=${encodeURIComponent(id)}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(requestUrl, { method: 'GET', headers: buildHeaders(settings) });
    if (res.status === 404 && attempt < 4) {
      await sleep(250 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      throw new Error(`openrouter generation fetch failed (${res.status}) for id=${id}`);
    }
    const body = (await res.json()) as { data?: unknown };
    return parseOpenRouterGenerationData(body.data);
  }
  return undefined;
}

export function mergeLlmUsage(preferred: LlmUsage | undefined, fallback: LlmUsage | undefined): LlmUsage | undefined {
  if (!preferred) return fallback;
  if (!fallback) return preferred;
  return {
    promptTokens: preferred.promptTokens || fallback.promptTokens,
    completionTokens: preferred.completionTokens || fallback.completionTokens,
    cachedPromptTokens: preferred.cachedPromptTokens ?? fallback.cachedPromptTokens,
    reasoningTokens: preferred.reasoningTokens ?? fallback.reasoningTokens,
    costUsd: preferred.costUsd ?? fallback.costUsd,
  };
}
