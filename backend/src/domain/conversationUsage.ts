import type { ConversationModelTokenUsageRow } from "../infra/repositories/chatEntriesRepo.js";
import { TokenUsageMapper } from "../types/tokenUsage.js";

export type ConversationTokenUsageByModel = {
  modelName: string;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
};

export function normalizeConversationTokenUsageRow(
  row: ConversationModelTokenUsageRow,
): ConversationTokenUsageByModel | null {
  const modelName = String(row.model_name || "").trim();
  if (!modelName) return null;
  const normalized = TokenUsageMapper.fromEntryFields({
    promptTokens: row.prompt_tokens,
    cachedPromptTokens: row.cached_prompt_tokens,
    completionTokens: row.completion_tokens,
  });
  if (!normalized) return null;
  return {
    modelName,
    promptTokens: normalized.promptTokens,
    cachedPromptTokens: normalized.cachedPromptTokens ?? 0,
    completionTokens: normalized.completionTokens,
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
