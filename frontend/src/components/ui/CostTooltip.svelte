<script lang="ts">
  import type { ModelPricing } from "@/lib/costEstimation";
  import { formatCostUsd } from "@/lib/providerCost";
  import { portal } from "@/lib/portal";
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

  const reported = $derived(providerCost != null && Number.isFinite(providerCost) ? providerCost : null);
  // Per-bucket math is only meaningful when the amount is derived from
  // configured pricing; a provider-reported figure is authoritative as-is.
  const estimated = $derived.by(() => {
    if (reported !== null || !pricing) return null;
    return {
      inUsd: (promptTokens / 1_000_000) * pricing.inCostPer1m,
      cachedUsd: (cachedTokens / 1_000_000) * pricing.cachedInCostPer1m,
      outUsd: (completionTokens / 1_000_000) * pricing.outCostPer1m,
    };
  });
  const totalUsd = $derived(
    reported !== null ? reported : estimated ? estimated.inUsd + estimated.cachedUsd + estimated.outUsd : null,
  );

  let open = $state(false);
  let anchor = $state<HTMLSpanElement | null>(null);
  let pos = $state({ x: 0, y: 0 });
  let placement = $state<"top" | "bottom">("top");

  function show(): void {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    const estHeight = 120;
    const halfWidth = 130;
    placement = rect.top - estHeight >= 4 ? "top" : "bottom";
    const x = Math.min(Math.max(rect.left + rect.width / 2, halfWidth + 8), window.innerWidth - halfWidth - 8);
    pos = { x, y: placement === "top" ? rect.top - 4 : rect.bottom + 4 };
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
    data-testid="cost-tooltip"
    class="pointer-events-none fixed z-[1500] -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 font-mono text-[11px] text-popover-foreground shadow-md {placement ===
    'top'
      ? '-translate-y-full'
      : ''}"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    role="tooltip"
  >
    {#if estimated && pricing}
      <span class="block">in: {formatTokenCount(promptTokens)} × ${pricing.inCostPer1m}/1m = {formatCostUsd(estimated.inUsd)}</span>
      <span class="block">cached: {formatTokenCount(cachedTokens)} × ${pricing.cachedInCostPer1m}/1m = {formatCostUsd(estimated.cachedUsd)}</span>
      <span class="block">out: {formatTokenCount(completionTokens)} × ${pricing.outCostPer1m}/1m = {formatCostUsd(estimated.outUsd)}</span>
    {/if}
    <span class="{estimated ? 'mt-1 block border-t border-border/40 pt-1' : 'block'}">
      {#if totalUsd !== null}
        cost: {formatCostUsd(totalUsd)}
      {:else}
        <span class="italic text-muted-foreground/60">cost: unknown — no pricing configured</span>
      {/if}
    </span>
    <span class="block text-[10px] text-muted-foreground">
      {reported !== null ? "reported by the provider" : estimated ? "estimated from configured pricing" : ""}
    </span>
  </span>
{/if}
