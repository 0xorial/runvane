<script lang="ts">
  import { TokenUsageMapper, type EntryTokenUsage } from "../../../../backend/src/contracts/token-usage";
  import { navigate } from "@/lib/router";

  let {
    model = "",
    usage,
    showTokenBreakdown = false,
    estimatedCostUsd,
    unpricedModels = [],
    class: className = "",
  }: {
    model?: string;
    usage?: EntryTokenUsage;
    showTokenBreakdown?: boolean;
    estimatedCostUsd?: number | null;
    unpricedModels?: string[];
    class?: string;
  } = $props();

  function formatCompactNumber(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    return value.toLocaleString();
  }

  function formatUsd(value: number): string {
    if (value > 0 && value < 0.01) return "<0.01";
    return value.toFixed(2);
  }

  const normalizedUsage = $derived(TokenUsageMapper.fromEntryFields(usage ?? {}));
  const totalTokens = $derived(
    normalizedUsage ? TokenUsageMapper.totalDisplayedTokens(normalizedUsage) : 0,
  );
  const modelShort = $derived.by(() => {
    const m = String(model).trim();
    return m.includes("/") ? (m.split("/").pop() ?? m) : m;
  });

  const hasContent = $derived(
    Boolean(modelShort) ||
      totalTokens > 0 ||
      estimatedCostUsd != null ||
      unpricedModels.length > 0,
  );

  function openPricing(): void {
    const q = unpricedModels.length > 0 ? `?models=${encodeURIComponent(unpricedModels.join(","))}` : "";
    navigate(`/settings/model-pricing${q}`);
  }
</script>

{#if hasContent}
  <span class="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground {className}">
    {#if modelShort}
      <span>{modelShort}</span>
    {/if}
    {#if normalizedUsage && totalTokens > 0}
      {#if showTokenBreakdown}
        <span title="token breakdown">
          in {formatCompactNumber(normalizedUsage.promptTokens)} / out {formatCompactNumber(normalizedUsage.completionTokens)} tok
        </span>
      {:else}
        <span>{formatCompactNumber(totalTokens)} tok</span>
      {/if}
    {/if}
    {#if estimatedCostUsd != null}
      <span>${formatUsd(estimatedCostUsd)}</span>
    {:else if unpricedModels.length > 0}
      <button type="button" class="underline hover:text-foreground" onclick={openPricing}>set pricing</button>
    {/if}
  </span>
{/if}
