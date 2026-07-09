<script lang="ts">
  import { isThoughtStreamEntry, type ChatEntry, type ThoughtPrepareEntry } from "@/protocol/chatEntry";
  import type { ObservableItem } from "@/utils/observableCollection";
  import Icon from "@/components/ui/Icon.svelte";
  import TokenTooltip from "@/components/ui/TokenTooltip.svelte";
  import { createAgentsQuery, createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import { getChatSessionContext, type ThoughtStage } from "@/lib/chatSessionContext";
  import { formatCostUsd, resolveStreamTokenBreakdown, streamCostUsd, streamTotalTokens } from "@/lib/providerCost";
  import { formatTokenCount } from "@/utils/formatTokenCount";
  import { formatDurationMs } from "@/utils/formatDurationMs";
  import { estimateTokenCount } from "@/utils/estimateTokenCount";
  import BranchSelector from "../BranchSelector.svelte";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";
  import StepChip from "./StepChip.svelte";
  import ThoughtTripletExpanded from "./ThoughtTripletExpanded.svelte";
  import { actionMetaLabel, displayStatus, findAncestorUserMessage, isAgentDefaultLlm } from "./thoughtTriplet/meta";
  import TryModelBranchButton from "./thoughtTriplet/TryModelBranchButton.svelte";

  let {
    prepareEntry,
    conversationId,
    streamEntry$,
    actionEntry = null,
  }: {
    prepareEntry: ChatEntry;
    conversationId: string;
    streamEntry$?: ObservableItem<ChatEntry>;
    actionEntry?: ChatEntry | null;
  } = $props();

  const capabilitiesQuery = createModelCapabilitiesQuery();
  const agentsQuery = createAgentsQuery();
  const session = getChatSessionContext();
  let expanded = $state<ThoughtStage | null>(null);
  const pricingByModel = $derived(pricingFromCapabilities(capabilitiesQuery.data));
  const detailOpen = $derived(session.getOpenDetailEntryId() === prepareEntry.id);

  const activeEntriesById = $derived.by(() => {
    const map = new Map<string, ChatEntry>();
    for (const row$ of session.getActivePathEntries()) {
      const entry = row$.get();
      map.set(entry.id, entry);
    }
    return map;
  });

  const thoughtAgent = $derived.by(() => {
    if (prepareEntry.type !== "thought-prepare") return null;
    const userMsg = findAncestorUserMessage(prepareEntry.parentId, activeEntriesById);
    if (!userMsg) return null;
    return (agentsQuery.data ?? []).find((agent) => agent.id === userMsg.agentId) ?? null;
  });

  let streamRaw = $state<ChatEntry | null>(null);

  const stream = $derived.by(() => {
    const raw = streamRaw;
    return raw && isThoughtStreamEntry(raw) ? raw : null;
  });

  $effect(() => {
    const row$ = streamEntry$;
    if (!row$) {
      streamRaw = null;
      return;
    }
    streamRaw = row$.get();
    return row$.subscribe(() => {
      streamRaw = row$.get();
    });
  });

  function toggle(stage: ThoughtStage): void {
    expanded = expanded === stage ? null : stage;
  }

  $effect(() => {
    void conversationId;
    expanded = null;
  });

  function reasonMetaParts(streamEntry: NonNullable<typeof stream>) {
    const provider = String(streamEntry.llm?.providerId || "").trim() || "unknown-provider";
    const model = String(streamEntry.llm?.model || "").trim() || "unknown-model";
    const status = displayStatus(streamEntry.status ?? "running");
    const tokens = resolveStreamTokenBreakdown(streamEntry);
    const totalTokens = streamTotalTokens(streamEntry);
    const isRunning = (streamEntry.status ?? "running") === "running";
    // While streaming, the provider hasn't reported usage yet, so approximate the
    // generated-token count from the text streamed so far (thinking + response).
    const estimatedTokens = estimateTokenCount(
      streamEntry.thinkingText,
      streamEntry.assembledResponse || streamEntry.llmResponse,
    );
    const durationLabel = streamEntry.thoughtMs != null ? `${Math.round(streamEntry.thoughtMs)}ms` : "";
    const pricing = pricingByModel.get(model);
    const showModel = !isAgentDefaultLlm(streamEntry.llm, thoughtAgent);
    const providerCost =
      typeof streamEntry.provider_cost === "number" && Number.isFinite(streamEntry.provider_cost)
        ? streamEntry.provider_cost
        : null;
    return {
      provider,
      model,
      status,
      promptTokens: tokens.input,
      cachedTokens: tokens.cached,
      completionTokens: tokens.output,
      totalTokens,
      isRunning,
      estimatedTokens,
      durationLabel,
      pricing,
      showModel,
      providerCost,
    };
  }
</script>

{#if prepareEntry.type !== "thought-prepare"}
  <!-- invalid -->
{:else if streamEntry$ && stream}
  {@const prep = prepareEntry as ThoughtPrepareEntry}
  {@const actionStep = actionEntry?.type === "thought-action" ? actionEntry : null}
  {@const contextTitle = String(prep.title ?? "").trim() || "Preparation"}
  {@const actionMeta = actionMetaLabel(actionStep, stream)}
  {@const actionLabel = actionMeta.usesTool ? `call ${actionMeta.toolName ?? "tool"}` : "Reply"}
  {@const reasonFailed = stream.status === "failed" || stream.status === "cancelled"}
  {@const reasonMeta = reasonMetaParts(stream)}
  {@const finished = (stream.status ?? "running") !== "running"}
  {#if finished}
    <!-- Compact view: finished thoughts dim down to one line; clicking it
         opens the full stage details in the right-hand panel. -->
    {@const costUsd = streamCostUsd(stream, reasonMeta.pricing)}
    {@const durationLabel = stream.thoughtMs != null ? formatDurationMs(stream.thoughtMs) : ""}
    <ChatThreadIndent class="py-0 mb-1">
      {#snippet children()}
        <div class="my-0 border-l-2 border-border/40 pl-3">
          <div class="flex items-center gap-1 py-0.5 text-[11px]">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left transition-colors hover:bg-secondary/60 {detailOpen
                ? 'bg-secondary/70 text-foreground'
                : 'text-muted-foreground/60 hover:text-muted-foreground'}"
              data-testid="thought-collapsed-row"
              title="Show details"
              onclick={() => session.toggleEntryDetail(prep.id)}
            >
              {#if reasonFailed}
                <RowIcon name="alert" class="h-3 w-3 shrink-0" />
              {:else}
                <RowIcon name="sparkles" class="h-3 w-3 shrink-0 opacity-50" />
              {/if}
              <span class="truncate font-medium">{contextTitle}</span>
              <span class="shrink-0 opacity-70">→ {actionLabel}</span>
              <span class="ml-auto flex shrink-0 items-center gap-2 pl-2 font-mono text-[10px]">
                {#if reasonMeta.totalTokens > 0}<span>{formatTokenCount(reasonMeta.totalTokens)}</span>{/if}
                {#if costUsd !== null}<span>{formatCostUsd(costUsd)}</span>{/if}
                {#if durationLabel}<span>{durationLabel}</span>{/if}
                {#if reasonMeta.showModel}<span class="max-w-[14rem] truncate">{reasonMeta.model}</span>{/if}
                {#if reasonMeta.status}<span class="text-destructive/80">{reasonMeta.status}</span>{/if}
              </span>
            </button>
            <span class="flex shrink-0 items-center gap-0.5 text-muted-foreground">
              <TryModelBranchButton prepareEntry={prep} {stream} {conversationId} />
              <BranchSelector entryId={prep.id} />
              <BranchSelector entryId={stream.id} />
              {#if actionStep}<BranchSelector entryId={actionStep.id} />{/if}
            </span>
          </div>
        </div>
      {/snippet}
    </ChatThreadIndent>
  {:else}
  <ChatThreadIndent class="py-0 mb-1">
    {#snippet children()}
      <div class="my-0 border-l-2 border-border/60 pl-3">
        <div class="flex items-stretch gap-2 py-0.5 text-[11px] text-muted-foreground">
          <StepChip testId="thought-step-context" label={contextTitle} active={expanded === "context"} onclick={() => toggle("context")}>
            {#snippet icon()}<RowIcon name="file" />{/snippet}
            {#snippet badge()}
              <span class="inline-flex items-center gap-0.5">
                <TryModelBranchButton prepareEntry={prep} {stream} {conversationId} />
                <BranchSelector entryId={prep.id} />
              </span>
            {/snippet}
          </StepChip>
          <Icon name="arrow-right" class="h-3 w-3 self-center opacity-60" />
          <StepChip testId="thought-step-reasoning" label="" active={expanded === "reasoning"} onclick={() => toggle("reasoning")}>
            {#snippet badge()}<BranchSelector entryId={stream.id} />{/snippet}
            {#snippet icon()}
              {#if reasonFailed}
                <RowIcon name="alert" />
              {:else if stream.status === "running"}
                <span class="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true"></span>
              {:else}
                <RowIcon name="sparkles" />
              {/if}
            {/snippet}
            {#snippet metaSlot()}
              {#if reasonMeta.totalTokens > 0}
                <TokenTooltip
                  promptTokens={reasonMeta.promptTokens}
                  cachedTokens={reasonMeta.cachedTokens}
                  completionTokens={reasonMeta.completionTokens}
                  pricing={reasonMeta.pricing}
                  providerCost={reasonMeta.providerCost}
                >
                  {#snippet children()}{formatTokenCount(reasonMeta.totalTokens)}{/snippet}
                </TokenTooltip>
              {:else if reasonMeta.isRunning && reasonMeta.estimatedTokens > 0}
                <span title="Approximate, estimated from streamed text">~{formatTokenCount(reasonMeta.estimatedTokens)}</span>
              {/if}
              {#if reasonMeta.durationLabel}<span>{reasonMeta.durationLabel}</span>{/if}
              {#if reasonMeta.showModel || expanded === "reasoning"}<span>{reasonMeta.provider}/{reasonMeta.model}</span>{/if}
              {#if reasonMeta.status}<span>{reasonMeta.status}</span>{/if}
            {/snippet}
          </StepChip>
          <Icon name="arrow-right" class="h-3 w-3 self-center opacity-60" />
          <StepChip
            label={actionLabel}
            meta={actionMeta.status}
            align="right"
            active={expanded === "action"}
            testId="thought-step-action"
            onclick={() => toggle("action")}
          >
            {#snippet icon()}
              <RowIcon name={actionMeta.usesTool ? "wrench" : "message"} />
            {/snippet}
            {#snippet badge()}
              {#if actionStep}<BranchSelector entryId={actionStep.id} />{/if}
            {/snippet}
          </StepChip>
        </div>
        {#if expanded === "context"}
          <ThoughtTripletExpanded stage="context" prepareEntry={prep} {stream} actionEntry={actionStep} {conversationId} />
        {:else if expanded === "reasoning"}
          <ThoughtTripletExpanded stage="reasoning" prepareEntry={prep} {stream} actionEntry={actionStep} {conversationId} />
        {:else if expanded === "action"}
          <ThoughtTripletExpanded stage="action" prepareEntry={prep} {stream} actionEntry={actionStep} {conversationId} />
        {/if}
      </div>
    {/snippet}
  </ChatThreadIndent>
  {/if}
{:else if prepareEntry.type === "thought-prepare"}
  {@const prep = prepareEntry as ThoughtPrepareEntry}
  {@const contextTitle = String(prep.title ?? "").trim() || "Preparation"}
  <ChatThreadIndent class="py-0 mb-1">
    {#snippet children()}
      <div class="my-0 border-l-2 border-border/60 pl-3">
        <div class="flex items-stretch gap-2 py-0.5 text-[11px] text-muted-foreground">
          <StepChip label={contextTitle} active={false} onclick={() => undefined}>
            {#snippet icon()}<RowIcon name="file" />{/snippet}
          </StepChip>
          <Icon name="arrow-right" class="h-3 w-3 self-center opacity-60" />
          <StepChip label="" meta="reasoning…" active={false} onclick={() => undefined}>
            {#snippet icon()}
              <span class="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true"></span>
            {/snippet}
          </StepChip>
        </div>
      </div>
    {/snippet}
  </ChatThreadIndent>
{/if}
