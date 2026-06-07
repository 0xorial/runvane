<script lang="ts">
  import { isThoughtStreamEntry, type ChatEntry, type ThoughtPrepareEntry } from "@/protocol/chatEntry";
  import type { ObservableItem } from "@/utils/observableCollection";
  import Icon from "@/components/ui/Icon.svelte";
  import TokenTooltip from "@/components/ui/TokenTooltip.svelte";
  import { createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import { getChatSessionContext, type ThoughtStage } from "@/lib/chatSessionContext";
  import { formatTokenCount } from "@/utils/formatTokenCount";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";
  import StepChip from "./StepChip.svelte";
  import ThoughtTripletExpanded from "./ThoughtTripletExpanded.svelte";
  import { actionMetaLabel, displayStatus } from "./thoughtTriplet/meta";

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

  const session = getChatSessionContext();
  const capabilitiesQuery = createModelCapabilitiesQuery();
  const pricingByModel = $derived(pricingFromCapabilities(capabilitiesQuery.data));

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

  function slotKey(prep: ThoughtPrepareEntry, streamEntry: NonNullable<typeof stream>): string {
    return prep.parentId ?? streamEntry.thoughtId;
  }

  function toggle(prep: ThoughtPrepareEntry, streamEntry: NonNullable<typeof stream>, stage: ThoughtStage): void {
    const key = slotKey(prep, streamEntry);
    const current = session.getExpandedStage(key);
    session.setSlotExpandedStage(key, current === stage ? null : stage);
  }

  function reasonMetaParts(streamEntry: NonNullable<typeof stream>) {
    const provider = String(streamEntry.llm?.providerId || "").trim() || "unknown-provider";
    const model = String(streamEntry.llm?.model || "").trim() || "unknown-model";
    const status = displayStatus(streamEntry.status ?? "running");
    const promptTokens = streamEntry.promptTokens ?? 0;
    const cachedTokens = streamEntry.cachedPromptTokens ?? 0;
    const completionTokens = streamEntry.completionTokens ?? 0;
    const totalTokens = promptTokens + cachedTokens + completionTokens;
    const durationLabel = streamEntry.thoughtMs != null ? `${Math.round(streamEntry.thoughtMs)}ms` : "";
    const pricing = pricingByModel.get(model);
    return { provider, model, status, promptTokens, cachedTokens, completionTokens, totalTokens, durationLabel, pricing };
  }
</script>

{#if prepareEntry.type !== "thought-prepare"}
  <!-- invalid -->
{:else if streamEntry$ && stream}
  {@const prep = prepareEntry as ThoughtPrepareEntry}
  {@const actionStep = actionEntry?.type === "thought-action" ? actionEntry : null}
  {@const key = slotKey(prep, stream)}
  {@const contextTitle = String(prep.title ?? "").trim() || "Preparation"}
  {@const actionMeta = actionMetaLabel(actionStep, stream)}
  {@const actionLabel = actionMeta.usesTool ? `call ${actionMeta.toolName ?? "tool"}` : "Reply"}
  {@const reasonFailed = stream.status === "failed" || stream.status === "cancelled"}
  {@const reasonMeta = reasonMetaParts(stream)}
  {@const expanded = (() => { session.getExpandedStageVersion(); return session.getExpandedStage(key); })()}
  <ChatThreadIndent class="py-0 mb-1">
    {#snippet children()}
      <div class="my-0 border-l-2 border-border/60 pl-3">
        <div class="flex items-stretch gap-2 py-0.5 text-[11px] text-muted-foreground">
          <StepChip label={contextTitle} active={expanded === "context"} onclick={() => toggle(prep, stream, "context")}>
            {#snippet icon()}<RowIcon name="file" />{/snippet}
          </StepChip>
          <Icon name="arrow-right" class="h-3 w-3 self-center opacity-60" />
          <StepChip label="" active={expanded === "reasoning"} onclick={() => toggle(prep, stream, "reasoning")}>
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
                >
                  {#snippet children()}{formatTokenCount(reasonMeta.totalTokens)}{/snippet}
                </TokenTooltip>
              {/if}
              {#if reasonMeta.durationLabel}<span>{reasonMeta.durationLabel}</span>{/if}
              <span>{reasonMeta.provider}/{reasonMeta.model}</span>
              {#if reasonMeta.status}<span>{reasonMeta.status}</span>{/if}
            {/snippet}
          </StepChip>
          <Icon name="arrow-right" class="h-3 w-3 self-center opacity-60" />
          <StepChip
            label={actionLabel}
            meta={actionMeta.status}
            align="right"
            active={expanded === "action"}
            onclick={() => toggle(prep, stream, "action")}
          >
            {#snippet icon()}
              <RowIcon name={actionMeta.usesTool ? "wrench" : "message"} />
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
