<script lang="ts">
  import { summarizeConversationCost, type ModelPricing, type TokenUsageByModelRow } from "@/lib/costEstimation";
  import { navigate } from "@/lib/router";
  import { portal } from "@/lib/portal";

  let {
    usageByModel,
    pricingByModel,
    class: className = "",
  }: {
    /** Per-model token usage for the conversation (provided externally by the host). */
    usageByModel: TokenUsageByModelRow[];
    /** Known model prices, cached on the frontend state (built from the model-capabilities query). */
    pricingByModel: Map<string, ModelPricing>;
    /** Extra classes merged onto the inline pill (e.g. the sidebar flattens it). */
    class?: string;
  } = $props();

  const summary = $derived(summarizeConversationCost(usageByModel, pricingByModel));

  // ---- formatting ----------------------------------------------------------

  function compactTokens(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(2))}m`;
    if (abs >= 1_000) return `${parseFloat((n / 1_000).toFixed(2))}k`;
    return String(n);
  }

  /** Headline amount, 2 decimals. `lowerBound` swaps the sub-cent rule so it reads with the `>` prefix. */
  function headlineAmount(value: number, lowerBound: boolean): string {
    if (value <= 0) return "0.00";
    if (value < 0.01) return lowerBound ? "0.00" : "<0.01";
    return value.toFixed(2);
  }

  /** Precise amount for the breakdown rows, trailing zeros trimmed. */
  function preciseUsd(value: number): string {
    if (value <= 0) return "$0.00";
    if (value < 0.000001) return "<$0.000001";
    if (value < 0.01) return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".00")}`;
    return `$${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
  }

  const headline = $derived.by(() => {
    switch (summary.state) {
      case "priced":
        return { kind: "price" as const, text: `$${headlineAmount(summary.knownCostUsd, false)}` };
      case "partial":
        // `>` denotes the shown cost is a lower bound — unpriced models add an unknown amount.
        return { kind: "price" as const, text: `$>${headlineAmount(summary.knownCostUsd, true)}` };
      case "unpriced":
        return { kind: "set" as const, text: "set pricing" };
      default:
        return { kind: "none" as const, text: "" };
    }
  });

  const pricingHref = $derived.by(() => {
    const focus = summary.unpricedModels;
    const q = focus.length > 0 ? `?focus=${encodeURIComponent(focus.join(","))}` : "";
    return `/settings/model-pricing${q}`;
  });

  /** Settings link focused on a single model — used by the per-row "set price" action. */
  function modelPricingHref(modelName: string): string {
    return `/settings/model-pricing?focus=${encodeURIComponent(modelName)}`;
  }

  const setPricingTitle = $derived.by(() => {
    const m = summary.unpricedModels;
    if (m.length === 0) return "No pricing configured. Click to set it.";
    const noun = m.length === 1 ? "model" : "models";
    return `No pricing for ${noun}: ${m.join(", ")}. Click to set it.`;
  });

  // ---- hover popover --------------------------------------------------------

  let anchorEl = $state<HTMLSpanElement | null>(null);
  let open = $state(false);
  let placement = $state<"top" | "bottom">("bottom");
  let pos = $state({ x: 0, y: 0 });
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function place(): void {
    const r = anchorEl?.getBoundingClientRect();
    if (!r) return;
    // Rough popover height: header + a row per model + total row.
    const estHeight = 30 + summary.perModel.length * 20 + 26;
    const enoughBelow = r.bottom + 6 + estHeight < window.innerHeight;
    placement = enoughBelow ? "bottom" : "top";
    const x = Math.min(Math.max(8, r.left), window.innerWidth - 296);
    pos = { x, y: enoughBelow ? r.bottom + 4 : r.top - 4 };
  }

  function show(): void {
    if (summary.state === "empty") return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    place();
    open = true;
  }

  function scheduleHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      open = false;
      hideTimer = null;
    }, 120);
  }
</script>

{#if summary.state !== "empty"}
  <span
    bind:this={anchorEl}
    role="presentation"
    data-testid="conversation-cost"
    data-cost-state={summary.state}
    class="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground {className}"
    onmouseenter={show}
    onmouseleave={scheduleHide}
    onfocusin={show}
    onfocusout={scheduleHide}
  >
    {#if summary.totalTokens > 0}
      <span class="cursor-default underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">
        {compactTokens(summary.totalTokens)} tok
      </span>
      <span class="text-border">•</span>
    {/if}
    {#if headline.kind === "set"}
      <button
        type="button"
        class="border-0 bg-transparent p-0 font-mono text-muted-foreground/80 underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
        title={setPricingTitle}
        onclick={() => navigate(pricingHref)}
      >
        {headline.text}
      </button>
    {:else}
      <span class="cursor-default underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">
        {headline.text}
      </span>
    {/if}
  </span>
{/if}

{#if open}
  <div
    use:portal
    role="tooltip"
    class="fixed z-[1500] w-72 max-w-[90vw] rounded-md border border-border bg-popover px-2.5 py-2 font-mono text-[11px] text-popover-foreground shadow-md {placement ===
    'top'
      ? '-translate-y-full'
      : ''}"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    onmouseenter={show}
    onmouseleave={scheduleHide}
  >
    <div class="mb-1 flex items-center justify-between border-b border-border/40 pb-1 text-muted-foreground">
      <span>per-model cost</span>
      <span>{compactTokens(summary.totalTokens)} tok</span>
    </div>
    <div class="flex flex-col gap-1">
      {#each summary.perModel as row (row.modelName)}
        <div class="flex items-baseline justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="truncate" title={row.modelName || "(unknown model)"}>{row.modelName || "(unknown model)"}</div>
            <div class="text-[10px] text-muted-foreground">
              in {compactTokens(row.promptTokens)}{#if row.cachedPromptTokens > 0}<span class="text-muted-foreground/70">
                  (cached {compactTokens(row.cachedPromptTokens)})</span
                >{/if} / out {compactTokens(row.completionTokens)}
            </div>
          </div>
          <div class="shrink-0 whitespace-nowrap text-right">
            {#if row.costUsd !== null}
              {preciseUsd(row.costUsd)}
            {:else if row.modelName}
              <button
                type="button"
                class="border-0 bg-transparent p-0 font-mono text-warning underline decoration-dotted underline-offset-2 hover:text-foreground hover:decoration-foreground"
                title={`Set pricing for ${row.modelName}`}
                onclick={() => navigate(modelPricingHref(row.modelName))}
              >
                set price
              </button>
            {:else}
              <span class="text-warning">no price</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    <div class="mt-1 flex items-baseline justify-between border-t border-border/40 pt-1">
      <span class="text-muted-foreground">total</span>
      <span class="font-medium">
        {#if summary.state === "unpriced"}
          <span class="text-warning">unknown</span>
        {:else if summary.state === "partial"}
          <span title="At least this much — some models have no pricing.">≥ {preciseUsd(summary.knownCostUsd)}</span>
        {:else}
          {preciseUsd(summary.knownCostUsd)}
        {/if}
      </span>
    </div>
  </div>
{/if}
