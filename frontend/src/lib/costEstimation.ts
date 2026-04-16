import type { ModelCapabilityRow } from "../../../backend/src/types/modelCatalog";
import { TokenUsageMapper, type EntryTokenUsage } from "../../../backend/src/types/tokenUsage";

export type TokenUsageByModelRow = {
  modelName: string;
} & Required<Pick<EntryTokenUsage, "promptTokens" | "cachedPromptTokens" | "completionTokens">>;

export type ModelPricing = {
  inCostPer1m: number;
  cachedInCostPer1m: number;
  outCostPer1m: number;
};

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildModelPricingByName(capabilities: ModelCapabilityRow[]): Map<string, ModelPricing> {
  const out = new Map<string, ModelPricing>();
  for (const cap of capabilities) {
    const model = String(cap.model_name || "").trim();
    if (!model || out.has(model)) continue;
    const inCost = finiteOrNull(cap.usd_per_1m_tokens_in) ?? finiteOrNull(cap.input_cost_per_1m);
    const outCost = finiteOrNull(cap.usd_per_1m_tokens_out) ?? finiteOrNull(cap.output_cost_per_1m);
    const cachedInCost =
      finiteOrNull(cap.usd_per_1m_tokens_in_cached) ?? finiteOrNull(cap.cached_input_cost_per_1m) ?? inCost;
    if (inCost == null || outCost == null || cachedInCost == null) continue;
    out.set(model, {
      inCostPer1m: inCost,
      cachedInCostPer1m: cachedInCost,
      outCostPer1m: outCost,
    });
  }
  return out;
}

export function estimateConversationCostUsd(
  usageRows: TokenUsageByModelRow[],
  pricingByModel: Map<string, ModelPricing>,
): number {
  let total = 0;
  for (const usage of usageRows) {
    const prices = pricingByModel.get(String(usage.modelName || "").trim());
    if (!prices) continue;
    const normalized = TokenUsageMapper.fromEntryFields({
      promptTokens: usage.promptTokens,
      cachedPromptTokens: usage.cachedPromptTokens,
      completionTokens: usage.completionTokens,
    });
    if (!normalized) continue;
    const promptSplit = TokenUsageMapper.promptUsageBreakdown(normalized);
    const boundedCompletion = normalized.completionTokens;
    total +=
      (promptSplit.nonCachedPrompt / 1_000_000) * prices.inCostPer1m +
      (promptSplit.cachedPrompt / 1_000_000) * prices.cachedInCostPer1m +
      (boundedCompletion / 1_000_000) * prices.outCostPer1m;
  }
  return Number(total.toFixed(8));
}
