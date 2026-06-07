<script lang="ts">
  import { isThoughtStreamEntry, type ChatEntry } from "@/protocol/chatEntry";
  import type { ThoughtTripletRefs } from "@/lib/thoughtTriplets";
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import AssistantMessageRow from "./rows/AssistantMessageRow.svelte";
  import ThoughtTripletRow from "./rows/ThoughtTripletRow.svelte";
  import ToolRunRow from "./rows/ToolRunRow.svelte";
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
      streamEntry$={refs?.streamEntry$}
      actionEntry={refs?.actionEntry ?? null}
    />
  {:else if isThoughtStreamEntry(entry) || entry.type === "thought-action"}
    <!-- rendered inside prepare-anchored triplet -->
  {:else if entry.type === "assistant-message"}
    <AssistantMessageRow {entry} {conversationId} />
  {:else if entry.type === "tool-invocation"}
    <ToolRunRow {entry} />
  {:else if entry.type === "checkpoint-summary"}
    <div class="animate-slide-in group py-1.5">
      <div class="mx-auto max-w-3xl text-xs italic text-muted-foreground">{entry.summaryText}</div>
    </div>
  {/if}
{/if}
