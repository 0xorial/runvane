<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getTools, retryToolInvocation } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import { formatCostUsd, streamCostUsd, streamTotalTokens } from "@/lib/providerCost";
  import { buildThoughtTripletsById } from "@/lib/thoughtTriplets";
  import { isThoughtStreamEntry, type ChatEntry, type ThoughtStreamEntry } from "@/protocol/chatEntry";
  import type { ObservableItem } from "@/utils/observableCollection";
  import { formatDurationMs } from "@/utils/formatDurationMs";
  import { formatTokenCount } from "@/utils/formatTokenCount";
  import { notifyError } from "@/utils/toast";
  import CollapsibleBlock from "@/components/ui/CollapsibleBlock.svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import RowIcon from "./RowIcon.svelte";
  import ThoughtTripletExpanded from "./rows/ThoughtTripletExpanded.svelte";

  let {
    conversationId,
    entryId,
    allEntries,
    activePathEntries,
    onClose,
  }: {
    conversationId: string;
    entryId: string;
    allEntries: ObservableItem<LinkedChatEntry>[];
    activePathEntries: ObservableItem<LinkedChatEntry>[];
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

  // Stage refs come from the ACTIVE path (mirrors the transcript): a thoughtId
  // can have sibling streams on other branches, and the panel must show the
  // branch the user is looking at.
  const tripletRefs = $derived.by(() => {
    if (!entry || entry.type !== "thought-prepare") return null;
    return buildThoughtTripletsById(activePathEntries).get(entry.thoughtId) ?? null;
  });
  let streamRaw = $state<ChatEntry | null>(null);
  $effect(() => {
    const stream$ = tripletRefs?.streamEntry$;
    if (!stream$) {
      streamRaw = null;
      return;
    }
    streamRaw = stream$.get();
    return stream$.subscribe(() => {
      streamRaw = stream$.get();
    });
  });
  const stream = $derived(streamRaw && isThoughtStreamEntry(streamRaw) ? streamRaw : null);
  const actionEntry = $derived(tripletRefs?.actionEntry?.type === "thought-action" ? tripletRefs.actionEntry : null);
  const prepEntry = $derived(entry?.type === "thought-prepare" ? entry : null);
  const THOUGHT_STAGES = ["context", "reasoning", "action"] as const;

  const capabilitiesQuery = createModelCapabilitiesQuery();
  const pricingByModel = $derived(pricingFromCapabilities(capabilitiesQuery.data));

  // The stage sections below carry the full token breakdown; this line is the
  // at-a-glance summary the collapsed row also shows.
  function thoughtMetaLine(s: ThoughtStreamEntry): string {
    const model = String(s.llm?.model || "").trim();
    const provider = String(s.llm?.providerId || "").trim();
    const total = streamTotalTokens(s);
    const cost = streamCostUsd(s, pricingByModel.get(model));
    const parts = [
      provider && model ? `${provider}/${model}` : model || "",
      total > 0 ? formatTokenCount(total) : "",
      cost !== null ? formatCostUsd(cost) : "",
      s.thoughtMs != null ? formatDurationMs(s.thoughtMs) : "",
    ];
    return parts.filter(Boolean).join(" · ");
  }

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
    const { tool_request, source, __tool_batch, ...params } = toolEntry.parameters as Record<string, unknown>;
    void tool_request; void source; void __tool_batch;
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
    const ms = toolEntry.result?.timing?.elapsed_ms;
    const parts = [
      toolStatusLabel,
      typeof ms === "number" ? formatDurationMs(ms) : "",
      (toolEntry.attempt ?? 1) > 1 ? `attempt ${toolEntry.attempt}` : "",
      toolLocation ? `${toolLocation} sandbox` : "",
    ];
    return parts.filter(Boolean).join(" · ");
  });
  // Retry applies to genuine execution failures only; blocked entries (forbid,
  // tool-not-found) also persist as `error` but never ran and must keep zero
  // affordances (their envelope carries permission_state ≠ 'allow').
  const retryable = $derived(toolEntry?.state === "error" && toolEntry.result?.permission_state === "allow");
  let retrying = $state(false);

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
    if (entry.type === "thought-prepare") return String(entry.title ?? "").trim() || "Thought";
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
      </div>
    {:else if prepEntry && stream}
      <div class="space-y-3 text-xs">
        <div class="font-mono text-[10px] text-muted-foreground">{thoughtMetaLine(stream)}</div>
        {#each THOUGHT_STAGES as stage (stage)}
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{stage}</div>
            <ThoughtTripletExpanded {stage} prepareEntry={prepEntry} {stream} {actionEntry} {conversationId} />
          </div>
        {/each}
      </div>
    {:else if prepEntry}
      <p class="text-xs text-muted-foreground">This thought has no reasoning stream on the active path.</p>
    {:else}
      <p class="text-xs text-muted-foreground">No details for this entry type.</p>
    {/if}
  </div>
</div>
