<script lang="ts">
  import type { ModelPricing } from "@/lib/costEstimation";
  import { portal } from "@/lib/portal";
  import { formatTokenCount } from "@/utils/formatTokenCount";
  import type { Snippet } from "svelte";

  let {
    children,
    promptTokens,
    cachedTokens,
    completionTokens,
    pricing,
  }: {
    children: Snippet;
    promptTokens: number;
    cachedTokens: number;
    completionTokens: number;
    pricing?: ModelPricing;
  } = $props();

  let open = $state(false);
  let anchor = $state<HTMLSpanElement | null>(null);
  let pos = $state({ x: 0, y: 0 });

  const cost = $derived.by(() => {
    if (!pricing) return null;
    return (
      (promptTokens / 1_000_000) * pricing.inCostPer1m +
      (cachedTokens / 1_000_000) * pricing.cachedInCostPer1m +
      (completionTokens / 1_000_000) * pricing.outCostPer1m
    );
  });

  function formatCostUsd(usd: number): string {
    if (usd === 0) return "$0.00";
    if (usd < 0.000001) return "<$0.000001";
    if (usd < 0.01) return `$${usd.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".00")}`;
    return `$${usd.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
  }

  function show(): void {
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    pos = { x: rect.left + rect.width / 2, y: rect.top };
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
    class="pointer-events-none fixed z-[1500] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 font-mono text-[11px] text-popover-foreground shadow-md"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
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
