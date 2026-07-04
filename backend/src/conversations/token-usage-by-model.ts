import type { ConversationRow } from '../contracts/conversations.js';

type UsageTotals = {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  /** Sum of provider-reported USD across this model's counted turns. */
  providerCostUsd: number;
  /** How many counted turns actually reported a cost. */
  reportedTurns: number;
  turns: number;
};

function usageFromStreamPayload(payload: Record<string, unknown>): Omit<UsageTotals, 'providerCostUsd' | 'reportedTurns' | 'turns'> | null {
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

function providerCostFromPayload(payload: Record<string, unknown>): number | null {
  const cost = payload.provider_cost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function aggregateTokenUsageByModel(
  streamPayloads: Array<{ modelName: string; payload: Record<string, unknown> }>,
): ConversationRow['tokenUsageByModel'] {
  const byModel = new Map<string, UsageTotals>();
  for (const { modelName, payload } of streamPayloads) {
    const usage = usageFromStreamPayload(payload);
    if (!usage) continue;
    const cur =
      byModel.get(modelName) ??
      { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, providerCostUsd: 0, reportedTurns: 0, turns: 0 };
    cur.promptTokens += usage.promptTokens;
    cur.cachedPromptTokens += usage.cachedPromptTokens;
    cur.completionTokens += usage.completionTokens;
    cur.turns += 1;
    const cost = providerCostFromPayload(payload);
    if (cost !== null) {
      cur.providerCostUsd += cost;
      cur.reportedTurns += 1;
    }
    byModel.set(modelName, cur);
  }
  return Array.from(byModel.entries())
    .map(([modelName, totals]) => ({
      modelName,
      promptTokens: totals.promptTokens,
      cachedPromptTokens: totals.cachedPromptTokens,
      completionTokens: totals.completionTokens,
      // Null = no turn reported a cost (distinct from a genuine $0 total).
      providerCostUsd: totals.reportedTurns > 0 ? Number(totals.providerCostUsd.toFixed(8)) : null,
      providerCostComplete: totals.reportedTurns === totals.turns && totals.turns > 0,
    }))
    .sort((a, b) => a.modelName.localeCompare(b.modelName));
}
