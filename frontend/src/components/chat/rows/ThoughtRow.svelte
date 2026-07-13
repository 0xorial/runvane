<script lang="ts">
  import type { ThoughtEntry } from "@/protocol/chatEntry";
  import Icon from "@/components/ui/Icon.svelte";
  import TokenTooltip from "@/components/ui/TokenTooltip.svelte";
  import { createAgentsQuery, createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import { getChatSessionContext, type ThoughtStage } from "@/lib/chatSessionContext";
  import { formatCostUsd, resolveStreamTokenBreakdown, streamCostUsd, streamTotalTokens } from "@/lib/providerCost";
  import { formatTokenCount } from "@/utils/formatTokenCount";
  import { formatDurationMs } from "@/utils/formatDurationMs";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";
  import { estimateTokenCount } from "@/utils/estimateTokenCount";
  import BranchSelector from "../BranchSelector.svelte";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";
  import StepChip from "./StepChip.svelte";
  import ThoughtExpanded from "./ThoughtExpanded.svelte";
  import { actionMetaLabel, displayStatus, findAncestorUserMessage, isAgentDefaultLlm } from "./thought/meta";
  import TryModelBranchButton from "./thought/TryModelBranchButton.svelte";

  let {
    entry,
    conversationId,
  }: {
    entry: ThoughtEntry;
    conversationId: string;
  } = $props();

  const capabilitiesQuery = createModelCapabilitiesQuery();
  const agentsQuery = createAgentsQuery();
  const session = getChatSessionContext();
  let expanded = $state<ThoughtStage | null>(null);
  const pricingByModel = $derived(pricingFromCapabilities(capabilitiesQuery.data));
  const detailOpen = $derived(session.getOpenDetailEntryId() === entry.id);

  const activeEntriesById = $derived.by(() => {
    const map = new Map<string, ThoughtEntry | import("@/protocol/chatEntry").ChatEntry>();
    for (const row$ of session.getActivePathEntries()) {
      const e = row$.get();
      map.set(e.id, e);
    }
    return map;
  });

  const thoughtAgent = $derived.by(() => {
    const userMsg = findAncestorUserMessage(entry.parentId, activeEntriesById);
    if (!userMsg) return null;
    return (agentsQuery.data ?? []).find((agent) => agent.id === userMsg.agentId) ?? null;
  });

  function toggle(stage: ThoughtStage): void {
    expanded = expanded === stage ? null : stage;
  }

  $effect(() => {
    void conversationId;
    expanded = null;
  });

  const reasonMeta = $derived.by(() => {
    const provider = String(entry.llm?.providerId || "").trim() || "unknown-provider";
    const model = String(entry.llm?.model || "").trim() || "unknown-model";
    const status = displayStatus(entry.status);
    const tokens = resolveStreamTokenBreakdown(entry);
    const totalTokens = streamTotalTokens(entry);
    const isRunning = entry.status === "running";
    // While streaming, the provider hasn't reported usage yet, so approximate the
    // generated-token count from the text streamed so far (thinking + response).
    const estimatedTokens = estimateTokenCount(entry.thinkingText, entry.assembledResponse || entry.llmResponse);
    const durationLabel = entry.thoughtMs != null ? `${Math.round(entry.thoughtMs)}ms` : "";
    const pricing = pricingByModel.get(model);
    const showModel = !isAgentDefaultLlm(entry.llm, thoughtAgent);
    const providerCost =
      typeof entry.provider_cost === "number" && Number.isFinite(entry.provider_cost) ? entry.provider_cost : null;
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
  });

  const contextTitle = $derived(String(entry.title ?? "").trim() || "Preparation");
  const actionMeta = $derived(actionMetaLabel(entry));
  const actionLabel = $derived(actionMeta.usesTool ? `call ${actionMeta.toolName ?? "tool"}` : "Reply");
  const failed = $derived(entry.status === "failed" || entry.status === "cancelled");
  const finished = $derived(entry.status !== "running");
</script>

{#if finished}
  <!-- Compact view: finished thoughts dim down to one line; clicking it
       opens the full stage details in the right-hand panel. -->
  {@const costUsd = streamCostUsd(entry, reasonMeta.pricing)}
  {@const durationLabel = entry.thoughtMs != null ? formatDurationMs(entry.thoughtMs) : ""}
  {@const createdStamp = formatRelativeChatTime(entry.createdAt)}
  <ChatThreadIndent class="py-0">
    {#snippet children()}
      <div class="my-0 border-l-2 border-border/40 pl-3">
        <div class="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-0.5 text-left transition-colors hover:bg-secondary/60 {detailOpen
              ? 'bg-secondary/70 text-foreground'
              : 'text-muted-foreground/60 hover:text-muted-foreground'}"
            data-testid="thought-collapsed-row"
            title="Show details"
            onclick={() => session.toggleEntryDetail(entry.id)}
          >
            {#if failed}
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
              {#if createdStamp}<span class="opacity-70" title={formatExactChatTime(entry.createdAt)}>{createdStamp}</span>{/if}
            </span>
          </button>
          <span class="flex shrink-0 items-center gap-0.5 text-muted-foreground">
            <BranchSelector entryId={entry.id} />
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
                {#if entry.stage !== "prepare"}
                  <TryModelBranchButton {entry} {conversationId} />
                {/if}
                <BranchSelector entryId={entry.id} />
              </span>
            {/snippet}
          </StepChip>
          <Icon name="arrow-right" class="h-3 w-3 self-center opacity-60" />
          <StepChip testId="thought-step-reasoning" label="" active={expanded === "reasoning"} onclick={() => toggle("reasoning")}>
            {#snippet icon()}
              {#if entry.stage === "prepare" || entry.stage === "reason"}
                <span class="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true"></span>
              {:else}
                <RowIcon name="sparkles" />
              {/if}
            {/snippet}
            {#snippet metaSlot()}
              {#if entry.stage === "prepare"}
                <span>preparing…</span>
              {:else}
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
                {:else if reasonMeta.estimatedTokens > 0}
                  <span title="Approximate, estimated from streamed text">~{formatTokenCount(reasonMeta.estimatedTokens)}</span>
                {/if}
                {#if reasonMeta.durationLabel}<span>{reasonMeta.durationLabel}</span>{/if}
                {#if reasonMeta.showModel || expanded === "reasoning"}<span>{reasonMeta.provider}/{reasonMeta.model}</span>{/if}
              {/if}
            {/snippet}
          </StepChip>
          <Icon name="arrow-right" class="h-3 w-3 self-center opacity-60" />
          <StepChip
            label={actionLabel}
            meta={entry.stage === "decide" ? "running" : ""}
            align="right"
            active={expanded === "action"}
            testId="thought-step-action"
            onclick={() => toggle("action")}
          >
            {#snippet icon()}
              <RowIcon name={actionMeta.usesTool ? "wrench" : "message"} />
            {/snippet}
          </StepChip>
        </div>
        {#if expanded !== null}
          <ThoughtExpanded stage={expanded} {entry} {conversationId} />
        {/if}
      </div>
    {/snippet}
  </ChatThreadIndent>
{/if}
