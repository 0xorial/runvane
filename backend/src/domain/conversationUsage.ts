import type { ConversationModelTokenUsageRow } from "../infra/repositories/chatEntriesRepo.js";

export type ConversationTokenUsageByModel = {
  model_name: string;
  prompt_tokens: number;
  cached_prompt_tokens: number;
  completion_tokens: number;
};

export function normalizeConversationTokenUsageRow(
  row: ConversationModelTokenUsageRow,
): ConversationTokenUsageByModel | null {
  const modelName = String(row.model_name || "").trim();
  if (!modelName) return null;
  const promptTokens =
    typeof row.prompt_tokens === "number" && Number.isFinite(row.prompt_tokens)
      ? Math.max(0, Math.trunc(row.prompt_tokens))
      : 0;
  const cachedPromptTokens =
    typeof row.cached_prompt_tokens === "number" && Number.isFinite(row.cached_prompt_tokens)
      ? Math.max(0, Math.min(Math.trunc(row.cached_prompt_tokens), promptTokens))
      : 0;
  const completionTokens =
    typeof row.completion_tokens === "number" && Number.isFinite(row.completion_tokens)
      ? Math.max(0, Math.trunc(row.completion_tokens))
      : 0;
  return {
    model_name: modelName,
    prompt_tokens: promptTokens,
    cached_prompt_tokens: cachedPromptTokens,
    completion_tokens: completionTokens,
  };
}

export function usageByConversationId(
  rows: ConversationModelTokenUsageRow[],
): Map<string, ConversationTokenUsageByModel[]> {
  const out = new Map<string, ConversationTokenUsageByModel[]>();
  for (const row of rows) {
    const normalized = normalizeConversationTokenUsageRow(row);
    if (!normalized) continue;
    const existing = out.get(row.conversation_id) ?? [];
    existing.push(normalized);
    out.set(row.conversation_id, existing);
  }
  return out;
}
