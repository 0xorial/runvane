<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getTools, getToolRuns, retryToolInvocation } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import { formatCostUsd, resolveStreamTokenBreakdown, streamCostUsd, streamTotalTokens } from "@/lib/providerCost";
  import { toolRequestBrief } from "@/lib/toolRequestBrief";
  import { actionMetaLabel } from "./rows/thought/meta";
  import type { ChatEntry } from "@/protocol/chatEntry";
  import type { ObservableItem } from "@/utils/observableCollection";
  import { formatDurationMs } from "@/utils/formatDurationMs";
  import { formatExactChatTime } from "@/utils/formatRelativeChatTime";
  import { formatTokenCount } from "@/utils/formatTokenCount";
  import { notifyError } from "@/utils/toast";
  import CollapsibleBlock from "@/components/ui/CollapsibleBlock.svelte";
  import CostTooltip from "@/components/ui/CostTooltip.svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import TokenTooltip from "@/components/ui/TokenTooltip.svelte";
  import RowIcon from "./RowIcon.svelte";
  import ThoughtExpanded from "./rows/ThoughtExpanded.svelte";
  import TryModelBranchButton from "./rows/thought/TryModelBranchButton.svelte";

  let {
    conversationId,
    entryId,
    allEntries,
    onClose,
  }: {
    conversationId: string;
    entryId: string;
    allEntries: ObservableItem<LinkedChatEntry>[];
    onClose: () => void;
  } = $props();

  const row$ = $derived(allEntries.find((r) => r.id === entryId) ?? null);
  let entry = $state<ChatEntry | null>(null);
  $effect(() => {
    const row = row$;
    if (!row) {
      entry = null;
      return;
    }
    entry = row.get();
    return row.subscribe(() => {
      entry = row.get();
    });
  });

  // ---- thought details -------------------------------------------------------

  const thoughtEntry = $derived(entry?.type === "thought" ? entry : null);
  const THOUGHT_STAGES = ["context", "reasoning", "action"] as const;

  const capabilitiesQuery = createModelCapabilitiesQuery();
  const pricingByModel = $derived(pricingFromCapabilities(capabilitiesQuery.data));

  // At-a-glance line above the stage sections; the token count carries the
  // same hover breakdown (in/cached/out) as everywhere else via TokenTooltip.
  const thoughtMeta = $derived.by(() => {
    const t = thoughtEntry;
    if (!t) return null;
    const model = String(t.llm?.model || "").trim();
    const provider = String(t.llm?.providerId || "").trim();
    const breakdown = resolveStreamTokenBreakdown(t);
    const total = streamTotalTokens(t);
    const cost = streamCostUsd(t, pricingByModel.get(model));
    return {
      modelLabel: provider && model ? `${provider}/${model}` : model || "",
      breakdown,
      total,
      cost,
      pricing: pricingByModel.get(model),
      providerCost: t.provider_cost ?? null,
      durationLabel: t.thoughtMs != null ? formatDurationMs(t.thoughtMs) : "",
    };
  });

  // ---- tool details ----------------------------------------------------------

  const toolEntry = $derived(entry?.type === "tool-invocation" ? entry : null);
  const toolsQuery = createQuery(() => ({ queryKey: queryKeys.tools, queryFn: getTools }));
  const toolLocation = $derived.by(() => {
    if (!toolEntry) return null;
    const row = (toolsQuery.data ?? []).find((t) => t.name === toolEntry.toolId);
    return row?.location === "target" || row?.location === "harness" ? row.location : null;
  });
  const guardrailReason = $derived.by(() => {
    const err = toolEntry?.result?.error ?? null;
    if (!err) return null;
    const prefix = "Guardrail flagged: ";
    return err.startsWith(prefix) ? err.slice(prefix.length) : null;
  });
  const cleanParams = $derived.by(() => {
    if (!toolEntry) return {};
    const { tool_request, tool_note, source, __tool_batch, ...params } = toolEntry.parameters as Record<string, unknown>;
    void tool_request; void tool_note; void source; void __tool_batch;
    return params;
  });
  const toolStatusLabel = $derived.by(() => {
    switch (toolEntry?.state) {
      case "resolving": return "Resolving arguments";
      case "requested": return "Needs approval";
      case "running": return "Running";
      case "done": return "Done";
      case "denied": return "Denied";
      case "error": return "Failed";
      default: return "";
    }
  });
  const toolMetaLine = $derived.by(() => {
    if (!toolEntry) return "";
    const timing = toolEntry.result?.timing;
    const startedAt = timing?.started_at ?? toolEntry.createdAt;
    const parts = [
      toolStatusLabel,
      typeof timing?.elapsed_ms === "number" ? formatDurationMs(timing.elapsed_ms) : "",
      (toolEntry.attempt ?? 1) > 1 ? `attempt ${toolEntry.attempt}` : "",
      toolLocation ? `${toolLocation} sandbox` : "",
      formatExactChatTime(startedAt),
    ];
    return parts.filter(Boolean).join(" · ");
  });
  // Retry applies to genuine execution failures only; blocked entries (forbid,
  // tool-not-found) also persist as `error` but never ran and must keep zero
  // affordances (their envelope carries permission_state ≠ 'allow').
  const retryable = $derived(toolEntry?.state === "error" && toolEntry.result?.permission_state === "allow");
  let retrying = $state(false);

  // Transient progress streamed onto the row while the tool runs (chatSessionStore).
  const liveOutput = $derived((entry as unknown as { liveOutput?: string } | null)?.liveOutput ?? "");
  // Per-attempt execution records incl. the persisted progress log. Keyed on
  // the entry's state so reaching a terminal state refetches the final log.
  const runsQuery = createQuery(() => ({
    queryKey: ["tool-runs", conversationId, entryId, toolEntry?.state ?? "none"],
    queryFn: () => getToolRuns(conversationId, entryId),
    enabled: toolEntry != null,
  }));

  async function onRetryClick(): Promise<void> {
    if (!toolEntry || retrying) return;
    retrying = true;
    try {
      await retryToolInvocation(conversationId, toolEntry.id);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Failed to retry tool");
    } finally {
      retrying = false;
    }
  }

  function stringifyMaybe(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  }

  const headerTitle = $derived.by(() => {
    if (!entry) return "Details";
    if (entry.type === "tool-invocation") return entry.toolId || "tool";
    if (entry.type === "thought") return String(entry.title ?? "").trim() || "Thought";
    return "Details";
  });
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="entry-detail-panel">
  <div class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
    {#if entry?.type === "tool-invocation"}
      <RowIcon name="wrench" class="h-3.5 w-3.5 shrink-0 text-primary" />
    {:else}
      <RowIcon name="sparkles" class="h-3.5 w-3.5 shrink-0 text-primary" />
    {/if}
    <h3 class="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-foreground">{headerTitle}</h3>
    <button
      type="button"
      class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      data-testid="entry-detail-close"
      aria-label="Close details"
      onclick={onClose}
    >
      <Icon name="x" class="h-3.5 w-3.5" />
    </button>
  </div>
  <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2">
    {#if !entry}
      <p class="text-xs text-muted-foreground">This entry is no longer available.</p>
    {:else if toolEntry}
      <div class="space-y-2 text-xs" data-tool-state={toolEntry.state}>
        {#if toolMetaLine}
          <div class="font-mono text-[10px] text-muted-foreground">{toolMetaLine}</div>
        {/if}
        {#if toolRequestBrief(toolEntry)}
          <!-- The planner's own words for what this call is for (same LLM turn as the call). -->
          <div class="text-[11px] italic text-muted-foreground">“{toolRequestBrief(toolEntry)}”</div>
        {/if}
        {#if guardrailReason}
          <div class="flex items-start gap-1.5 rounded-md bg-warning/10 px-2.5 py-2 text-xs text-warning">
            <span class="font-semibold">Guardrail:</span>
            <span>{guardrailReason}</span>
          </div>
        {/if}
        {#if toolEntry.state === "error" && toolEntry.result?.error}
          <div class="rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            <span class="font-semibold">Error:</span> {toolEntry.result.error}
          </div>
        {/if}
        {#if retryable}
          <div class="pt-1">
            <button
              type="button"
              data-testid="tool-retry-button"
              onclick={() => void onRetryClick()}
              disabled={retrying}
              class="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              <Icon name="rotate-cw" class="h-3 w-3 shrink-0" />
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        {/if}
        {#if toolEntry.state === "denied"}
          <div class="rounded-md bg-secondary/60 px-2.5 py-2 text-xs text-muted-foreground">
            <span class="font-semibold">Denied</span> — this tool was not run.
          </div>
        {/if}
        <div>
          <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
            {toolEntry.parametersEdited ? "Arguments (edited by you)" : "Arguments"}
          </span>
          <CollapsibleBlock class="mt-1">
            <pre class="overflow-x-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">{stringifyMaybe(cleanParams)}</pre>
          </CollapsibleBlock>
        </div>
        {#if toolEntry.parametersEdited && toolEntry.originalParameters}
          <div>
            <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Original arguments (as requested by the model)</span>
            <CollapsibleBlock class="mt-1">
              <pre class="overflow-x-auto rounded bg-background p-2 font-mono text-xs text-muted-foreground" data-testid="tool-original-params">{stringifyMaybe(toolEntry.originalParameters)}</pre>
            </CollapsibleBlock>
          </div>
        {/if}
        {#if toolEntry.result?.output != null}
          <div>
            <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Result</span>
            <CollapsibleBlock class="mt-1" collapsedMaxPx={240}>
              <pre class="overflow-x-auto rounded bg-background p-2 font-mono text-xs text-secondary-foreground">{stringifyMaybe(toolEntry.result.output)}</pre>
            </CollapsibleBlock>
          </div>
        {/if}
        {#if toolEntry.state === "running" && liveOutput}
          <div>
            <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Live output</span>
            <pre
              class="scrollbar-thin mt-1 max-h-60 overflow-auto rounded bg-background p-2 font-mono text-[11px] text-secondary-foreground"
              data-testid="detail-live-output">{liveOutput}</pre>
          </div>
        {/if}
        {#if (runsQuery.data?.runs.length ?? 0) > 0}
          <div data-testid="tool-runs-section">
            <span class="text-[10px] uppercase tracking-wider text-muted-foreground">Run log</span>
            <div class="mt-1 space-y-2">
              {#each runsQuery.data?.runs ?? [] as run (run.id)}
                <div class="rounded border border-border/60">
                  <div class="flex items-center gap-2 rounded-t border-b border-border/40 bg-secondary/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    <span>attempt {run.attempt}</span>
                    <span class={run.status === "error" || run.status === "aborted" ? "text-destructive/80" : ""}>
                      {run.status}
                    </span>
                    {#if run.elapsedMs != null}<span>{formatDurationMs(run.elapsedMs)}</span>{/if}
                    <span class="ml-auto">{formatExactChatTime(run.startedAt)}</span>
                  </div>
                  {#if run.error}
                    <div class="px-2 py-1 text-[11px] text-destructive">{run.error}</div>
                  {/if}
                  {#if run.outputLog}
                    <CollapsibleBlock class="p-1">
                      <pre class="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background p-2 font-mono text-[11px] text-secondary-foreground">{run.outputLog}</pre>
                    </CollapsibleBlock>
                  {:else}
                    <div class="px-2 py-1 text-[10px] italic text-muted-foreground/70">no log output</div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {:else if thoughtEntry}
      <div class="space-y-3 text-xs">
        {#if thoughtMeta}
          <div class="flex items-start justify-between gap-2">
          <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
            {#if thoughtMeta.modelLabel}<span>{thoughtMeta.modelLabel}</span>{/if}
            {#if thoughtMeta.total > 0}
              <span class="text-border">·</span>
              <TokenTooltip
                promptTokens={thoughtMeta.breakdown.input}
                cachedTokens={thoughtMeta.breakdown.cached}
                completionTokens={thoughtMeta.breakdown.output}
                pricing={thoughtMeta.pricing}
                providerCost={thoughtMeta.providerCost}
              >
                {#snippet children()}{formatTokenCount(thoughtMeta.total)}{/snippet}
              </TokenTooltip>
            {/if}
            {#if thoughtMeta.cost !== null}
              <span class="text-border">·</span>
              <CostTooltip
                promptTokens={thoughtMeta.breakdown.input}
                cachedTokens={thoughtMeta.breakdown.cached}
                completionTokens={thoughtMeta.breakdown.output}
                pricing={thoughtMeta.pricing}
                providerCost={thoughtMeta.providerCost}
              >
                <!-- Guarded non-null at 'cost !== null' above; the snippet closure loses the narrowing. -->
                {#snippet children()}{formatCostUsd(thoughtMeta.cost ?? 0)}{/snippet}
              </CostTooltip>
            {/if}
            {#if thoughtMeta.durationLabel}
              <span class="text-border">·</span>
              <span>{thoughtMeta.durationLabel}</span>
            {/if}
            <span class="text-border">·</span>
            <span>{formatExactChatTime(thoughtEntry.createdAt)}</span>
          </div>
          <span class="shrink-0 text-muted-foreground">
            <TryModelBranchButton entry={thoughtEntry} {conversationId} />
          </span>
          </div>
        {/if}
        {#each THOUGHT_STAGES as stage (stage)}
          {@const stageIcon =
            stage === "context"
              ? ("file" as const)
              : stage === "reasoning"
                ? ("sparkles" as const)
                : actionMetaLabel(thoughtEntry).usesTool
                  ? ("wrench" as const)
                  : ("message" as const)}
          <!-- No overflow-hidden here: it would become the sticky context for
               the Show-less chips inside and pin them uselessly. -->
          <section class="rounded-md border border-border/70">
            <div class="flex items-center gap-1.5 rounded-t-md border-b border-border/60 bg-secondary/50 px-2.5 py-1.5">
              <RowIcon name={stageIcon} class="h-3 w-3 shrink-0 text-primary" />
              <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{stage}</span>
            </div>
            <div class="px-2.5 pb-2.5">
              <ThoughtExpanded {stage} entry={thoughtEntry} {conversationId} />
            </div>
          </section>
        {/each}
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">No details for this entry type.</p>
    {/if}
  </div>
</div>
