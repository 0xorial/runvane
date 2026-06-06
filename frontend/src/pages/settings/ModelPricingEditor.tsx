import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Check, X, Server } from "lucide-react";
import type { ModelCapabilityRow } from "../../../../backend/src/contracts/model-catalog";
import { getModelCapabilities, updateModelCapabilityOverride } from "../../api/client";
import { invalidatePricingCache } from "../../lib/pricingCache";
import { Spinner } from "../../components/ui/Spinner";
import { cn } from "@/lib/utils";
import { ghostBtn } from "./settingsClasses";

type EditState = {
  input: string;
  cachedInput: string;
  output: string;
  selfHosted: boolean;
};

type RowState = {
  editing: boolean;
  draft: EditState;
  saving: boolean;
  error: string | null;
};

function formatCost(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

function parseCostInput(raw: string): number | null {
  const cleaned = raw.replace(/^\$/, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function draftFromRow(row: ModelCapabilityRow): EditState {
  return {
    input: row.input_cost_per_1m != null ? String(row.input_cost_per_1m) : "",
    cachedInput: row.cached_input_cost_per_1m != null ? String(row.cached_input_cost_per_1m) : "",
    output: row.output_cost_per_1m != null ? String(row.output_cost_per_1m) : "",
    selfHosted: row.self_hosted === true,
  };
}

function hasPricing(row: ModelCapabilityRow): boolean {
  if (row.self_hosted) return true;
  return row.input_cost_per_1m != null && row.output_cost_per_1m != null;
}

function SourceBadge({ source }: { source: ModelCapabilityRow["source"] }) {
  const label = source === "override" ? "override" : source === "seed" ? "seed" : "discovered";
  const cls =
    source === "override"
      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
      : source === "seed"
        ? "bg-muted text-muted-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", cls)}>{label}</span>
  );
}

function CostCell({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-amber-600 dark:text-amber-500">—</span>;
  }
  return <span>{formatCost(value)}</span>;
}

function PriceInput({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        type="text"
        value={disabled ? "" : value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={disabled ? "n/a" : "—"}
        className="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

export function ModelPricingEditor() {
  const [rows, setRows] = useState<ModelCapabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Map<string, RowState>>(new Map());
  const [searchParams] = useSearchParams();
  const focusModels = useMemo(() => {
    const raw = searchParams.get("focus");
    if (!raw) return new Set<string>();
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [searchParams]);
  const firstFocusRowRef = useRef<HTMLTableRowElement | null>(null);
  const didScrollRef = useRef(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getModelCapabilities();
      setRows(data.models);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function rowKey(row: ModelCapabilityRow) {
    return `${row.provider_id}::${row.model_name}`;
  }

  function getRowState(row: ModelCapabilityRow): RowState {
    return (
      rowState.get(rowKey(row)) ?? {
        editing: false,
        draft: draftFromRow(row),
        saving: false,
        error: null,
      }
    );
  }

  function patchRowState(row: ModelCapabilityRow, patch: Partial<RowState>) {
    setRowState((prev) => {
      const next = new Map(prev);
      const current = prev.get(rowKey(row)) ?? {
        editing: false,
        draft: draftFromRow(row),
        saving: false,
        error: null,
      };
      next.set(rowKey(row), { ...current, ...patch });
      return next;
    });
  }

  function startEdit(row: ModelCapabilityRow) {
    patchRowState(row, { editing: true, draft: draftFromRow(row), error: null });
  }

  function cancelEdit(row: ModelCapabilityRow) {
    patchRowState(row, { editing: false, error: null });
  }

  async function saveRow(row: ModelCapabilityRow) {
    const state = getRowState(row);
    const selfHosted = state.draft.selfHosted;
    const inputCost = selfHosted ? null : parseCostInput(state.draft.input);
    const cachedCost = selfHosted ? null : parseCostInput(state.draft.cachedInput);
    const outputCost = selfHosted ? null : parseCostInput(state.draft.output);

    patchRowState(row, { saving: true, error: null });
    try {
      const result = await updateModelCapabilityOverride({
        provider_id: row.provider_id,
        model_name: row.model_name,
        input_cost_per_1m: inputCost,
        cached_input_cost_per_1m: cachedCost,
        output_cost_per_1m: outputCost,
        self_hosted: selfHosted,
        currency: "USD",
      });
      setRows(result.models);
      invalidatePricingCache();
      patchRowState(row, { editing: false, saving: false, error: null });
    } catch (e) {
      patchRowState(row, { saving: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const grouped = rows.reduce<Map<string, ModelCapabilityRow[]>>((acc, row) => {
    const group = acc.get(row.provider_id) ?? [];
    group.push(row);
    acc.set(row.provider_id, group);
    return acc;
  }, new Map());

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 text-muted-foreground">
        <Spinner size={16} />
        <span>Loading model pricing...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-[10px] border border-destructive/45 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
        {loadError}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-[18px] text-muted-foreground">
        No models discovered yet. Connect a provider in{" "}
        <strong>Model Providers</strong> to populate this list.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">
        Override per-model pricing (USD per 1M tokens). Affects cost estimates in the chat UI.
      </p>
      {Array.from(grouped.entries()).map(([providerId, providerRows]) => (
        <div key={providerId} className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {providerId}
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-center font-medium">Self-hosted</th>
                <th className="px-3 py-2 text-right font-medium">Input /1M</th>
                <th className="px-3 py-2 text-right font-medium">Cached /1M</th>
                <th className="px-3 py-2 text-right font-medium">Output /1M</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {providerRows.map((row) => {
                const state = getRowState(row);
                const missing = !hasPricing(row) && !state.editing;
                const focused = focusModels.has(row.model_name);
                const isFirstFocus =
                  focused && firstFocusRowRef.current === null && !didScrollRef.current;
                return (
                  <tr
                    key={row.model_name}
                    ref={(el) => {
                      if (isFirstFocus && el) {
                        firstFocusRowRef.current = el;
                        didScrollRef.current = true;
                        el.scrollIntoView({ behavior: "smooth", block: "center" });
                      }
                    }}
                    className={cn(
                      "border-b border-border/50 last:border-0",
                      missing && "bg-amber-500/5",
                      focused && "bg-primary/10 ring-1 ring-primary/30",
                    )}
                  >
                    <td className="px-4 py-2.5 font-mono text-[12px]">
                      <span className={missing ? "text-amber-700 dark:text-amber-400" : ""}>
                        {row.model_name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <SourceBadge source={row.source} />
                    </td>
                    {state.editing ? (
                      <>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={state.draft.selfHosted}
                            onChange={(e) =>
                              patchRowState(row, {
                                draft: { ...state.draft, selfHosted: e.target.checked },
                              })
                            }
                            className="h-4 w-4 cursor-pointer accent-primary"
                            title="Self-hosted (no per-token cost)"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <PriceInput
                            label="input"
                            value={state.draft.input}
                            disabled={state.draft.selfHosted}
                            onChange={(v) =>
                              patchRowState(row, { draft: { ...state.draft, input: v } })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <PriceInput
                            label="cached"
                            value={state.draft.cachedInput}
                            disabled={state.draft.selfHosted}
                            onChange={(v) =>
                              patchRowState(row, { draft: { ...state.draft, cachedInput: v } })
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <PriceInput
                            label="output"
                            value={state.draft.output}
                            disabled={state.draft.selfHosted}
                            onChange={(v) =>
                              patchRowState(row, { draft: { ...state.draft, output: v } })
                            }
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={state.saving}
                              onClick={() => void saveRow(row)}
                              className={cn(ghostBtn, "flex items-center gap-1 px-2 py-1 text-xs")}
                            >
                              <Check className="h-3 w-3" />
                              {state.saving ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelEdit(row)}
                              className="rounded p-1 text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {state.error ? (
                            <div className="mt-1 text-[11px] text-destructive">{state.error}</div>
                          ) : null}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 text-center">
                          {row.self_hosted ? (
                            <span
                              className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                              title="Self-hosted (no per-token cost)"
                            >
                              <Server className="h-3 w-3" />
                              yes
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[12px]">
                          {row.self_hosted ? (
                            <span className="text-muted-foreground/50">n/a</span>
                          ) : (
                            <CostCell value={row.input_cost_per_1m} />
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[12px]">
                          {row.self_hosted ? (
                            <span className="text-muted-foreground/50">n/a</span>
                          ) : (
                            <CostCell value={row.cached_input_cost_per_1m} />
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[12px]">
                          {row.self_hosted ? (
                            <span className="text-muted-foreground/50">n/a</span>
                          ) : (
                            <CostCell value={row.output_cost_per_1m} />
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            title="Edit pricing"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
