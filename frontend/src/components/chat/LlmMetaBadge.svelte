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
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}b`;
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    return value.toLocaleString();
  }

  function formatExactUsd(value: number): string {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    });
  }

  function formatUsd(value: number): string {
    if (value > 0 && value < 0.01) return "<0.01";
    if (value < 0 && value > -0.01) return ">-0.01";
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

  type Segment = { key: string; label: string; title?: string; href?: string };

  const segments = $derived.by((): Segment[] => {
    const out: Segment[] = [];
    if (modelShort) out.push({ key: "model", label: modelShort });
    if (normalizedUsage && totalTokens > 0) {
      const prompt = normalizedUsage.promptTokens;
      const cachedPrompt = normalizedUsage.cachedPromptTokens ?? 0;
      const completion = normalizedUsage.completionTokens;
      if (showTokenBreakdown) {
        out.push({
          key: "tok",
          label: `in ${formatCompactNumber(prompt)} / out ${formatCompactNumber(completion)} tok`,
          title: `in ${prompt.toLocaleString()} / cached ${cachedPrompt.toLocaleString()} / out ${completion.toLocaleString()} tok`,
        });
      } else {
        out.push({
          key: "tok",
          label: `${formatCompactNumber(totalTokens)} tok`,
          title: `${totalTokens.toLocaleString()} tok`,
        });
      }
      if (cachedPrompt > 0) {
        out.push({
          key: "cached",
          label: `cached ${formatCompactNumber(cachedPrompt)} tok`,
          title: `${cachedPrompt.toLocaleString()} cached input tok`,
        });
      }
    }
    if (estimatedCostUsd === null) {
      const focusQuery =
        unpricedModels.length > 0 ? `?focus=${encodeURIComponent(unpricedModels.join(","))}` : "";
      const title =
        unpricedModels.length > 0
          ? `No pricing configured for ${unpricedModels.length === 1 ? "model" : "models"}: ${unpricedModels.join(", ")}. Click to set it.`
          : "No pricing configured. Click to set it.";
      out.push({
        key: "usd",
        label: "set pricing",
        title,
        href: `/settings/model-pricing${focusQuery}`,
      });
    } else if (typeof estimatedCostUsd === "number") {
      out.push({
        key: "usd",
        label: `$${formatUsd(estimatedCostUsd)}`,
        title: `$${formatExactUsd(estimatedCostUsd)}`,
      });
    }
    return out;
  });
</script>

{#if segments.length > 0}
  <div
    class="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground {className}"
  >
    {#each segments as seg, i (seg.key)}
      {#if i > 0}
        <span class="text-border">•</span>
      {/if}
      {#if seg.href}
        <button
          type="button"
          class="border-0 bg-transparent p-0 text-muted-foreground/70 underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
          title={seg.title}
          onclick={() => navigate(seg.href!)}
        >
          {seg.label}
        </button>
      {:else}
        <span title={seg.title}>{seg.label}</span>
      {/if}
    {/each}
  </div>
{/if}
