<script lang="ts">
  import type { ModelPricing } from "@/lib/costEstimation";
  import { popupPosition } from "@/lib/popupPosition";
  import { portal } from "@/lib/portal";
  import { formatCostUsd } from "@/lib/providerCost";
  import { formatTokenCount } from "@/utils/formatTokenCount";
  import type { Snippet } from "svelte";

  let {
    children,
    promptTokens,
    cachedTokens,
    completionTokens,
    pricing,
    providerCost,
  }: {
    children: Snippet;
    promptTokens: number;
    cachedTokens: number;
    completionTokens: number;
    pricing?: ModelPricing;
    providerCost?: number | null;
  } = $props();

  let open = $state(false);
  let anchor = $state<HTMLSpanElement | null>(null);

  const cost = $derived.by(() => {
    if (providerCost != null && Number.isFinite(providerCost)) return providerCost;
    if (!pricing) return null;
    return (
      (promptTokens / 1_000_000) * pricing.inCostPer1m +
      (cachedTokens / 1_000_000) * pricing.cachedInCostPer1m +
      (completionTokens / 1_000_000) * pricing.outCostPer1m
    );
  });

  function show(): void {
    open = true;
  }

  function hide(): void {
    open = false;
  }
</script>

<span
  bind:this={anchor}
  role="presentation"
  class="relative inline"
  onmouseenter={show}
  onmouseleave={hide}
  onfocusin={show}
  onfocusout={hide}
>
  <span class="cursor-default underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
    {@render children()}
  </span>
</span>

{#if open}
  <span
    use:portal
    use:popupPosition={{ anchor, align: "center", gap: 4, prefer: "above", fitHeight: false }}
    class="pointer-events-none fixed z-[1500] block whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 font-mono text-[11px] text-popover-foreground shadow-md"
    role="tooltip"
  >
    <span class="block">input: {formatTokenCount(promptTokens)}</span>
    <span class="block">cached: {formatTokenCount(cachedTokens)}</span>
    <span class="block">output: {formatTokenCount(completionTokens)}</span>
    <span class="mt-1 block border-t border-border/40 pt-1">
      {#if cost !== null}
        cost: {formatCostUsd(cost)}
      {:else}
        <span class="italic text-muted-foreground/60">cost: unknown</span>
      {/if}
    </span>
  </span>
{/if}
