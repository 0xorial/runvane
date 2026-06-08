import type { ConversationRow } from '../contracts/conversations.js';

type UsageTotals = {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
};

function usageFromStreamPayload(payload: Record<string, unknown>): UsageTotals | null {
  const breakdown = payload.provider_cost_breakdown;
  if (breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown)) {
    const rec = breakdown as Record<string, unknown>;
    const input = typeof rec.input === 'number' && Number.isFinite(rec.input) ? Math.trunc(rec.input) : null;
    const cached = typeof rec.cached === 'number' && Number.isFinite(rec.cached) ? Math.trunc(rec.cached) : null;
    const output = typeof rec.output === 'number' && Number.isFinite(rec.output) ? Math.trunc(rec.output) : null;
    if (input !== null && cached !== null && output !== null) {
      return { promptTokens: input + cached, cachedPromptTokens: cached, completionTokens: output };
    }
  }
  const promptTokens = typeof payload.promptTokens === 'number' && Number.isFinite(payload.promptTokens)
    ? Math.trunc(payload.promptTokens)
    : null;
  const completionTokens =
    typeof payload.completionTokens === 'number' && Number.isFinite(payload.completionTokens)
      ? Math.trunc(payload.completionTokens)
      : null;
  if (promptTokens === null || completionTokens === null) return null;
  const cachedRaw = payload.cachedPromptTokens;
  const cachedPromptTokens =
    typeof cachedRaw === 'number' && Number.isFinite(cachedRaw) ? Math.trunc(cachedRaw) : 0;
  if (promptTokens === 0 && cachedPromptTokens === 0 && completionTokens === 0) return null;
  return { promptTokens, cachedPromptTokens, completionTokens };
}

export function aggregateTokenUsageByModel(
  streamPayloads: Array<{ modelName: string; payload: Record<string, unknown> }>,
): ConversationRow['tokenUsageByModel'] {
  const byModel = new Map<string, UsageTotals>();
  for (const { modelName, payload } of streamPayloads) {
    const usage = usageFromStreamPayload(payload);
    if (!usage) continue;
    const cur = byModel.get(modelName) ?? { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 };
    cur.promptTokens += usage.promptTokens;
    cur.cachedPromptTokens += usage.cachedPromptTokens;
    cur.completionTokens += usage.completionTokens;
    byModel.set(modelName, cur);
  }
  return Array.from(byModel.entries())
    .map(([modelName, totals]) => ({ modelName, ...totals }))
    .sort((a, b) => a.modelName.localeCompare(b.modelName));
}
