import { StreamInterruptedError, type StreamTextCompletionUsage } from "../../llm_provider/provider.js";

function commonPrefixLen(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

export function incrementalDelta(prev: string, next: string): string {
  if (!next) return "";
  if (!prev) return next;
  if (next.startsWith(prev)) return next.slice(prev.length);
  return next.slice(commonPrefixLen(prev, next));
}

export function composeFailedPlannerResponse(partialReply: string): string {
  const partial = String(partialReply ?? "").trim();
  if (partial) return partial;
  return "";
}

export function usageFromStreamingError(error: unknown): StreamTextCompletionUsage | undefined {
  if (error instanceof StreamInterruptedError) {
    return error.usage;
  }
  if (!error || typeof error !== "object") return undefined;
  const usage = (error as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return undefined;
  }
  const usageRec = usage as Record<string, unknown>;
  const promptTokens = usageRec.promptTokens;
  const completionTokens = usageRec.completionTokens;
  const cachedPromptTokens = usageRec.cachedPromptTokens;
  if (
    typeof promptTokens !== "number" ||
    !Number.isFinite(promptTokens) ||
    typeof completionTokens !== "number" ||
    !Number.isFinite(completionTokens)
  ) {
    return undefined;
  }
  const normalized: StreamTextCompletionUsage = {
    promptTokens: Math.max(0, Math.trunc(promptTokens)),
    completionTokens: Math.max(0, Math.trunc(completionTokens)),
  };
  if (typeof cachedPromptTokens === "number" && Number.isFinite(cachedPromptTokens)) {
    normalized.cachedPromptTokens = Math.max(0, Math.trunc(cachedPromptTokens));
  }
  return normalized;
}
