import type { StreamTextCompletionUsage } from "../llm_provider/provider.js";

export type EntryTokenUsage = {
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
};

export type ConversationTotalsUsage = {
  promptTokensTotal?: number;
  cachedPromptTokensTotal?: number;
  completionTokensTotal?: number;
};

function toFiniteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toBoundedTokenCount(value: unknown): number | undefined {
  const finite = toFiniteOrUndefined(value);
  if (finite === undefined) return undefined;
  return Math.max(0, Math.trunc(finite));
}

function normalizeUsage(input: {
  promptTokens?: unknown;
  cachedPromptTokens?: unknown;
  completionTokens?: unknown;
}): StreamTextCompletionUsage | undefined {
  const promptTokens = toBoundedTokenCount(input.promptTokens);
  const completionTokens = toBoundedTokenCount(input.completionTokens);
  const cachedPromptTokensRaw = toBoundedTokenCount(input.cachedPromptTokens);
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  const cachedPromptTokens =
    cachedPromptTokensRaw === undefined ? undefined : Math.min(cachedPromptTokensRaw, promptTokens);
  return {
    promptTokens,
    completionTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
  };
}

export class TokenUsageMapper {
  static toEntryFields(usage: StreamTextCompletionUsage | undefined): EntryTokenUsage {
    const normalized = normalizeUsage(usage ?? {});
    if (!normalized) return {};
    return {
      promptTokens: normalized.promptTokens,
      completionTokens: normalized.completionTokens,
      ...(normalized.cachedPromptTokens !== undefined ? { cachedPromptTokens: normalized.cachedPromptTokens } : {}),
    };
  }

  static toSseFields(
    usage: StreamTextCompletionUsage | undefined
  ): { promptTokens?: number; cachedPromptTokens?: number; completionTokens?: number } {
    const normalized = normalizeUsage(usage ?? {});
    if (!normalized) return {};
    return {
      promptTokens: normalized.promptTokens,
      completionTokens: normalized.completionTokens,
      ...(normalized.cachedPromptTokens !== undefined ? { cachedPromptTokens: normalized.cachedPromptTokens } : {}),
    };
  }

  static fromEntryFields(entry: EntryTokenUsage): StreamTextCompletionUsage | undefined {
    return normalizeUsage({
      promptTokens: entry.promptTokens,
      cachedPromptTokens: entry.cachedPromptTokens,
      completionTokens: entry.completionTokens,
    });
  }

  static fromConversationTotals(input: ConversationTotalsUsage): EntryTokenUsage {
    const normalized = normalizeUsage({
      promptTokens: input.promptTokensTotal,
      cachedPromptTokens: input.cachedPromptTokensTotal,
      completionTokens: input.completionTokensTotal,
    });
    if (!normalized) return {};
    return this.toEntryFields(normalized);
  }

  static totalDisplayedTokens(usage: StreamTextCompletionUsage | undefined): number {
    const normalized = normalizeUsage(usage ?? {});
    if (!normalized) return 0;
    return normalized.promptTokens + normalized.completionTokens;
  }

  static promptUsageBreakdown(
    usage: StreamTextCompletionUsage | undefined
  ): { nonCachedPrompt: number; cachedPrompt: number } {
    const normalized = normalizeUsage(usage ?? {});
    if (!normalized) {
      return { nonCachedPrompt: 0, cachedPrompt: 0 };
    }
    const cachedPrompt = normalized.cachedPromptTokens ?? 0;
    return {
      nonCachedPrompt: Math.max(0, normalized.promptTokens - cachedPrompt),
      cachedPrompt,
    };
  }
}
