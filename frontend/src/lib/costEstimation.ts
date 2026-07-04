import type { ModelCapabilityRow } from "../../../backend/src/contracts/model-catalog";
import { TokenUsageMapper, type EntryTokenUsage } from "../../../backend/src/contracts/token-usage";

export type TokenUsageByModelRow = {
  modelName: string;
  /** Provider-reported USD for this model (null/absent = nothing reported). */
  providerCostUsd?: number | null;
  /** True when every turn reported a cost, i.e. the reported sum is exact. */
  providerCostComplete?: boolean;
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
    if (cap.self_hosted) {
      out.set(model, { inCostPer1m: 0, cachedInCostPer1m: 0, outCostPer1m: 0 });
      continue;
    }
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
    const normalized = TokenUsageMapper.fromEntryFields(usage);
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

/**
 * Distinct model names that actually consumed tokens but have no pricing entry —
 * i.e. the specific models that make a whole-conversation cost estimate impossible.
 * Names are trimmed and de-duplicated; blank names are dropped. Order follows first
 * appearance in `usageRows`.
 */
export function unpricedModelsWithUsage(
  usageRows: TokenUsageByModelRow[],
  pricingByModel: Map<string, ModelPricing>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const usage of usageRows) {
    const totalTokens = usage.promptTokens + usage.cachedPromptTokens + usage.completionTokens;
    if (totalTokens === 0) continue;
    const name = String(usage.modelName || "").trim();
    if (!name || seen.has(name) || pricingByModel.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Returns true if any usage row with tokens has no matching pricing entry. */
export function hasUnpricedUsage(
  usageRows: TokenUsageByModelRow[],
  pricingByModel: Map<string, ModelPricing>,
): boolean {
  return unpricedModelsWithUsage(usageRows, pricingByModel).length > 0;
}

/** Tokens that count toward a model's displayed total (cached prompt is a subset of prompt). */
function displayedTotalTokens(usage: TokenUsageByModelRow): number {
  return (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
}

/** One model's contribution to a conversation, with its cost (null when unknown). */
export type ModelCostRow = {
  modelName: string;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  /** Prompt + completion; cached prompt is already included in `promptTokens`. */
  totalTokens: number;
  /** USD for this model alone: provider-reported when available, else the
   *  pricing-table estimate, else null (unknown). */
  costUsd: number | null;
  /** Where `costUsd` came from. Provider-reported always wins over estimates. */
  source: "provider" | "estimate" | null;
  /** True when `costUsd` is a lower bound: the provider reported cost for only
   *  some of this model's turns. */
  lowerBound: boolean;
};

/**
 * Whole-conversation cost classification. The single source of truth shared by every
 * place that renders a conversation's price, so the sidebar and the title can never
 * disagree again:
 *  - `empty`    — no model consumed any tokens; there is nothing to price.
 *  - `unpriced` — tokens were used but NO used model has pricing → prompt to "set pricing".
 *  - `partial`  — some used models are priced and some are not; `knownCostUsd` is a lower
 *                 bound (render it as e.g. `$>0.11`).
 *  - `priced`   — every used model is priced; `knownCostUsd` is exact.
 */
export type ConversationCostState = "empty" | "unpriced" | "partial" | "priced";

export type ConversationCostSummary = {
  state: ConversationCostState;
  /** Sum of the priced models' costs. Exact when `priced`, a lower bound when `partial`, 0 otherwise. */
  knownCostUsd: number;
  /** Total prompt+completion tokens across every used model (priced or not). */
  totalTokens: number;
  /** Distinct used models that lack pricing, in first-appearance order (blank names dropped). */
  unpricedModels: string[];
  /** Per-model rows for models that actually consumed tokens, in first-appearance order. */
  perModel: ModelCostRow[];
};

/**
 * Classify a conversation's cost from its per-model token usage and the cached pricing map.
 * Pure: callers pass token usage (provided externally) and pricing (read from frontend cache).
 *
 * Per model, provider-reported cost (e.g. OpenRouter's per-generation USD)
 * always beats the pricing-table estimate — a model whose provider reports
 * cost never demands "set price". The pricing table is the fallback for
 * providers that only report tokens.
 */
export function summarizeConversationCost(
  usageRows: TokenUsageByModelRow[],
  pricingByModel: Map<string, ModelPricing>,
): ConversationCostSummary {
  const perModel: ModelCostRow[] = [];
  const unpricedSeen = new Set<string>();
  const unpricedModels: string[] = [];
  let totalTokens = 0;
  let knownCount = 0;
  let unknownCount = 0;
  let lowerBoundCount = 0;
  let costSum = 0;

  for (const usage of usageRows) {
    if (displayedTotalTokens(usage) === 0) continue;
    const name = String(usage.modelName || "").trim();
    const prices = name ? pricingByModel.get(name) : undefined;
    const rowTotal = displayedTotalTokens(usage);
    totalTokens += rowTotal;

    const reported = typeof usage.providerCostUsd === "number" ? usage.providerCostUsd : null;
    let costUsd: number | null;
    let source: ModelCostRow["source"];
    let lowerBound = false;
    if (reported !== null) {
      costUsd = reported;
      source = "provider";
      lowerBound = usage.providerCostComplete !== true;
    } else if (prices) {
      costUsd = estimateConversationCostUsd([usage], pricingByModel);
      source = "estimate";
    } else {
      costUsd = null;
      source = null;
    }

    if (costUsd === null) {
      unknownCount += 1;
      if (name && !unpricedSeen.has(name)) {
        unpricedSeen.add(name);
        unpricedModels.push(name);
      }
    } else {
      knownCount += 1;
      if (lowerBound) lowerBoundCount += 1;
      costSum += costUsd;
    }

    perModel.push({
      modelName: name,
      promptTokens: usage.promptTokens ?? 0,
      cachedPromptTokens: usage.cachedPromptTokens ?? 0,
      completionTokens: usage.completionTokens ?? 0,
      totalTokens: rowTotal,
      costUsd,
      source,
      lowerBound,
    });
  }

  const knownCostUsd = Number(costSum.toFixed(8));

  let state: ConversationCostState;
  if (perModel.length === 0) state = "empty";
  else if (knownCount === 0) state = "unpriced";
  else if (unknownCount > 0 || lowerBoundCount > 0) state = "partial";
  else state = "priced";

  return { state, knownCostUsd, totalTokens, unpricedModels, perModel };
}
