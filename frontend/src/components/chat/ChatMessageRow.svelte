<script lang="ts">
  import { isThoughtStreamEntry, type ChatEntry } from "@/protocol/chatEntry";
  import type { ThoughtTripletRefs } from "@/lib/thoughtTriplets";
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import AssistantMessageRow from "./rows/AssistantMessageRow.svelte";
  import ThoughtTripletRow from "./rows/ThoughtTripletRow.svelte";
  import ToolRunRow from "./rows/ToolRunRow.svelte";
  import CheckpointSummaryRow from "./rows/CheckpointSummaryRow.svelte";
  import ContextInjectionRow from "./rows/ContextInjectionRow.svelte";
  import UserMessageRow from "./rows/UserMessageRow.svelte";

  let {
    entry$,
    conversationId,
    thoughtTripletsById,
  }: {
    entry$: ObservableItem<LinkedChatEntry>;
    conversationId: string;
    thoughtTripletsById: ReadonlyMap<string, ThoughtTripletRefs>;
  } = $props();

  let entry = $state<ChatEntry | null>(null);

  $effect(() => {
    const row$ = entry$;
    entry = row$.get();
    return row$.subscribe(() => {
      entry = row$.get();
    });
  });
</script>

{#if entry}
  {#if entry.type === "user-message"}
    <UserMessageRow {entry} {conversationId} />
  {:else if entry.type === "thought-prepare"}
    {@const refs = thoughtTripletsById.get(entry.thoughtId)}
    <ThoughtTripletRow
      prepareEntry={entry}
      {conversationId}
      streamEntry$={refs?.streamEntry$}
      actionEntry={refs?.actionEntry ?? null}
    />
  {:else if isThoughtStreamEntry(entry) || entry.type === "thought-action"}
    <!-- rendered inside prepare-anchored triplet -->
  {:else if entry.type === "assistant-message"}
    <AssistantMessageRow {entry} {conversationId} />
  {:else if entry.type === "tool-invocation"}
    <ToolRunRow {entry} {conversationId} />
  {:else if entry.type === "checkpoint-summary"}
    <CheckpointSummaryRow {entry} />
  {:else if entry.type === "context-injection"}
    <ContextInjectionRow {entry} />
  {/if}
{/if}
