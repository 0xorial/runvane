<script lang="ts">
  import type { ModelCapabilityRow } from "../../../../backend/src/contracts/model-catalog";
  import { updateModelCapabilityOverride } from "@/api/client";
  import { createModelCapabilitiesQuery } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { queryClient } from "@/lib/queryClient";
  import { chatSearch } from "@/lib/router";
  import { ghostBtn } from "./settingsClasses";
  import {
    draftFromRow,
    formatCost,
    groupPricingRows,
    hasPricing,
    parseCostInput,
    pricingRowKey,
    sourceBadgeClass,
    type PricingEditState,
    type PricingRowState,
  } from "./modelPricingHelpers";

  const capabilitiesQuery = createModelCapabilitiesQuery();
  const rows = $derived(capabilitiesQuery.data?.models ?? []);
  const grouped = $derived(groupPricingRows(rows));

  const focusModels = $derived.by(() => {
    const raw = new URLSearchParams($chatSearch).get("focus");
    if (!raw) return new Set<string>();
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  });

  let rowState = $state<Map<string, PricingRowState>>(new Map());
  let didScrollFocus = $state(false);

  function getRowState(row: ModelCapabilityRow): PricingRowState {
    return (
      rowState.get(pricingRowKey(row)) ?? {
        editing: false,
        draft: draftFromRow(row),
        saving: false,
        error: null,
      }
    );
  }

  function patchRowState(row: ModelCapabilityRow, patch: Partial<PricingRowState>): void {
    const key = pricingRowKey(row);
    const current = getRowState(row);
    const next = new Map(rowState);
    next.set(key, { ...current, ...patch });
    rowState = next;
  }

  function startEdit(row: ModelCapabilityRow): void {
    patchRowState(row, { editing: true, draft: draftFromRow(row), error: null });
  }

  function cancelEdit(row: ModelCapabilityRow): void {
    patchRowState(row, { editing: false, error: null });
  }

  function patchDraft(row: ModelCapabilityRow, patch: Partial<PricingEditState>): void {
    const state = getRowState(row);
    patchRowState(row, { draft: { ...state.draft, ...patch } });
  }

  async function saveRow(row: ModelCapabilityRow): Promise<void> {
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
      queryClient.setQueryData(queryKeys.modelCapabilities, { models: result.models });
      patchRowState(row, { editing: false, saving: false, error: null });
    } catch (e) {
      patchRowState(row, {
        saving: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function scrollFocus(node: HTMLTableRowElement, focused: boolean): { destroy?: () => void } {
    if (focused && !didScrollFocus) {
      didScrollFocus = true;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return {};
  }
</script>

{#if capabilitiesQuery.isPending}
  <p class="text-sm text-muted-foreground">Loading model pricing…</p>
{:else if capabilitiesQuery.isError}
  <div class="rounded-[10px] border border-destructive/45 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
    {capabilitiesQuery.error instanceof Error ? capabilitiesQuery.error.message : String(capabilitiesQuery.error)}
  </div>
{:else if rows.length === 0}
  <div class="rounded-lg border border-dashed border-border bg-card p-[18px] text-muted-foreground">
    No models discovered yet. Connect a provider in <strong>Model Providers</strong> to populate this list.
  </div>
{:else}
  <div class="flex flex-col gap-4">
    <p class="text-[13px] text-muted-foreground">
      Override per-model pricing (USD per 1M tokens). Affects cost estimates in the chat UI.
    </p>
    {#each [...grouped.entries()] as [providerId, providerRows] (providerId)}
      <div class="rounded-lg border border-border bg-card">
        <div class="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {providerId}
        </div>
        <table class="w-full text-[13px]">
          <thead>
            <tr class="border-b border-border text-[11px] text-muted-foreground">
              <th class="px-4 py-2 text-left font-medium">Model</th>
              <th class="px-3 py-2 text-left font-medium">Source</th>
              <th class="px-3 py-2 text-center font-medium">Self-hosted</th>
              <th class="px-3 py-2 text-right font-medium">Input /1M</th>
              <th class="px-3 py-2 text-right font-medium">Cached /1M</th>
              <th class="px-3 py-2 text-right font-medium">Output /1M</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each providerRows as row (row.model_name)}
              {@const state = getRowState(row)}
              {@const missing = !hasPricing(row) && !state.editing}
              {@const focused = focusModels.has(row.model_name)}
              <tr
                class="border-b border-border/50 last:border-0 {missing ? 'bg-amber-500/5' : ''} {focused
                  ? 'bg-primary/10 ring-1 ring-primary/30'
                  : ''}"
                use:scrollFocus={focused}
              >
                <td class="px-4 py-2.5 font-mono text-[12px]">
                  <span class={missing ? "text-amber-700 dark:text-amber-400" : ""}>{row.model_name}</span>
                </td>
                <td class="px-3 py-2.5">
                  <span class="rounded px-1.5 py-0.5 text-[10px] font-medium {sourceBadgeClass(row.source)}">
                    {row.source}
                  </span>
                </td>
                {#if state.editing}
                  <td class="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={state.draft.selfHosted}
                      onchange={(e) => patchDraft(row, { selfHosted: e.currentTarget.checked })}
                      class="h-4 w-4 accent-primary"
                      title="Self-hosted (no per-token cost)"
                    />
                  </td>
                  <td class="px-3 py-2 text-right">
                    <input
                      type="text"
                      value={state.draft.selfHosted ? "" : state.draft.input}
                      disabled={state.draft.selfHosted}
                      oninput={(e) => patchDraft(row, { input: e.currentTarget.value })}
                      placeholder={state.draft.selfHosted ? "n/a" : "—"}
                      class="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-xs disabled:opacity-50"
                    />
                  </td>
                  <td class="px-3 py-2 text-right">
                    <input
                      type="text"
                      value={state.draft.selfHosted ? "" : state.draft.cachedInput}
                      disabled={state.draft.selfHosted}
                      oninput={(e) => patchDraft(row, { cachedInput: e.currentTarget.value })}
                      placeholder={state.draft.selfHosted ? "n/a" : "—"}
                      class="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-xs disabled:opacity-50"
                    />
                  </td>
                  <td class="px-3 py-2 text-right">
                    <input
                      type="text"
                      value={state.draft.selfHosted ? "" : state.draft.output}
                      disabled={state.draft.selfHosted}
                      oninput={(e) => patchDraft(row, { output: e.currentTarget.value })}
                      placeholder={state.draft.selfHosted ? "n/a" : "—"}
                      class="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-xs disabled:opacity-50"
                    />
                  </td>
                  <td class="px-3 py-2.5">
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={state.saving}
                        class={ghostBtn}
                        onclick={() => void saveRow(row)}
                      >
                        {state.saving ? "Saving…" : "Save"}
                      </button>
                      <button type="button" class="rounded p-1 text-muted-foreground hover:text-foreground" onclick={() => cancelEdit(row)}>
                        ✕
                      </button>
                    </div>
                    {#if state.error}
                      <div class="mt-1 text-[11px] text-destructive">{state.error}</div>
                    {/if}
                  </td>
                {:else}
                  <td class="px-3 py-2.5 text-center">
                    {#if row.self_hosted}
                      <span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        yes
                      </span>
                    {:else}
                      <span class="text-muted-foreground/50">—</span>
                    {/if}
                  </td>
                  <td class="px-3 py-2.5 text-right font-mono text-[12px]">
                    {#if row.self_hosted}
                      <span class="text-muted-foreground/50">n/a</span>
                    {:else if row.input_cost_per_1m == null}
                      <span class="text-amber-600 dark:text-amber-500">—</span>
                    {:else}
                      {formatCost(row.input_cost_per_1m)}
                    {/if}
                  </td>
                  <td class="px-3 py-2.5 text-right font-mono text-[12px]">
                    {#if row.self_hosted}
                      <span class="text-muted-foreground/50">n/a</span>
                    {:else if row.cached_input_cost_per_1m == null}
                      <span class="text-amber-600 dark:text-amber-500">—</span>
                    {:else}
                      {formatCost(row.cached_input_cost_per_1m)}
                    {/if}
                  </td>
                  <td class="px-3 py-2.5 text-right font-mono text-[12px]">
                    {#if row.self_hosted}
                      <span class="text-muted-foreground/50">n/a</span>
                    {:else if row.output_cost_per_1m == null}
                      <span class="text-amber-600 dark:text-amber-500">—</span>
                    {:else}
                      {formatCost(row.output_cost_per_1m)}
                    {/if}
                  </td>
                  <td class="px-3 py-2.5">
                    <button
                      type="button"
                      class="rounded p-1 text-muted-foreground hover:text-foreground"
                      title="Edit pricing"
                      onclick={() => startEdit(row)}
                    >
                      ✎
                    </button>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}
  </div>
{/if}
