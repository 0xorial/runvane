<script lang="ts">
  import { isThoughtStreamEntry, type ChatEntry, type ThoughtPrepareEntry } from "@/protocol/chatEntry";
  import type { ObservableItem } from "@/utils/observableCollection";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";
  import StepChip from "./StepChip.svelte";
  import ThoughtTripletExpanded from "./ThoughtTripletExpanded.svelte";
  import { actionMetaLabel, reasonMetaLabel } from "./thoughtTriplet/meta";

  type ThoughtStage = "context" | "reasoning" | "action";

  let {
    prepareEntry,
    streamEntry$,
    actionEntry = null,
  }: {
    prepareEntry: ChatEntry;
    streamEntry$?: ObservableItem<ChatEntry>;
    actionEntry?: ChatEntry | null;
  } = $props();

  let streamRaw = $state<ChatEntry | null>(null);
  let expanded = $state<ThoughtStage | null>(null);

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
  <ChatThreadIndent class="py-0 mb-1">
    {#snippet children()}
      <div class="my-0 border-l-2 border-border/60 pl-3">
        <div class="flex items-stretch gap-2 py-0.5 text-[11px] text-muted-foreground">
          <StepChip label={contextTitle} active={expanded === "context"} onclick={() => toggle("context")}>
            {#snippet icon()}
              <RowIcon name="file" />
            {/snippet}
          </StepChip>
          <span class="self-center opacity-60">→</span>
          <StepChip
            label=""
            meta={reasonMetaLabel(stream)}
            active={expanded === "reasoning"}
            onclick={() => toggle("reasoning")}
          >
            {#snippet icon()}
              {#if reasonFailed}
                <RowIcon name="alert" />
              {:else if stream.status === "running"}
                <span class="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true"></span>
              {:else}
                <RowIcon name="sparkles" />
              {/if}
            {/snippet}
          </StepChip>
          <span class="self-center opacity-60">→</span>
          <StepChip
            label={actionLabel}
            meta={actionMeta.status}
            align="right"
            active={expanded === "action"}
            onclick={() => toggle("action")}
          >
            {#snippet icon()}
              <RowIcon name={actionMeta.usesTool ? "wrench" : "message"} />
            {/snippet}
          </StepChip>
        </div>
        {#if expanded === "context"}
          <ThoughtTripletExpanded stage="context" prepareEntry={prep} {stream} actionEntry={actionStep} />
        {:else if expanded === "reasoning"}
          <ThoughtTripletExpanded stage="reasoning" prepareEntry={prep} {stream} actionEntry={actionStep} />
        {:else if expanded === "action"}
          <ThoughtTripletExpanded stage="action" prepareEntry={prep} {stream} actionEntry={actionStep} />
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
            {#snippet icon()}
              <RowIcon name="file" />
            {/snippet}
          </StepChip>
          <span class="self-center opacity-60">→</span>
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
