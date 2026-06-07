import type { ModelCapabilityRow } from "../../../../backend/src/contracts/model-catalog";

export type PricingEditState = {
  input: string;
  cachedInput: string;
  output: string;
  selfHosted: boolean;
};

export type PricingRowState = {
  editing: boolean;
  draft: PricingEditState;
  saving: boolean;
  error: string | null;
};

export function pricingRowKey(row: ModelCapabilityRow): string {
  return `${row.provider_id}::${row.model_name}`;
}

export function formatCost(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

export function parseCostInput(raw: string): number | null {
  const cleaned = raw.replace(/^\$/, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function draftFromRow(row: ModelCapabilityRow): PricingEditState {
  return {
    input: row.input_cost_per_1m != null ? String(row.input_cost_per_1m) : "",
    cachedInput: row.cached_input_cost_per_1m != null ? String(row.cached_input_cost_per_1m) : "",
    output: row.output_cost_per_1m != null ? String(row.output_cost_per_1m) : "",
    selfHosted: row.self_hosted === true,
  };
}

export function hasPricing(row: ModelCapabilityRow): boolean {
  if (row.self_hosted) return true;
  return row.input_cost_per_1m != null && row.output_cost_per_1m != null;
}

export function groupPricingRows(rows: ModelCapabilityRow[]): Map<string, ModelCapabilityRow[]> {
  const grouped = new Map<string, ModelCapabilityRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.provider_id) ?? [];
    group.push(row);
    grouped.set(row.provider_id, group);
  }
  return grouped;
}

export function sourceBadgeClass(source: ModelCapabilityRow["source"]): string {
  if (source === "override") return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  return "bg-muted text-muted-foreground";
}
