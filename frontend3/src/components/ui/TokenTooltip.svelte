<script lang="ts">
  import type { ModelPricing } from "@/lib/costEstimation";
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
</script>

<span
  role="presentation"
  class="relative inline"
  onmouseenter={() => (open = true)}
  onmouseleave={() => (open = false)}
  onfocusin={() => (open = true)}
  onfocusout={() => (open = false)}
>
  <span class="cursor-default underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
    {@render children()}
  </span>
  {#if open}
    <span
      class="absolute bottom-full left-1/2 z-[1500] mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 font-mono text-[11px] text-popover-foreground shadow-md"
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
</span>
