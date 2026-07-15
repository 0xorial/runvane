<script lang="ts">
  import type { ChatEntry } from "@/protocol/chatEntry";
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import AssistantMessageRow from "./rows/AssistantMessageRow.svelte";
  import ThoughtRow from "./rows/ThoughtRow.svelte";
  import ToolRunRow from "./rows/ToolRunRow.svelte";
  import TodoWriteRow from "./rows/TodoWriteRow.svelte";
  import CheckpointSummaryRow from "./rows/CheckpointSummaryRow.svelte";
  import ContextRow from "./rows/ContextRow.svelte";
  import UserMessageRow from "./rows/UserMessageRow.svelte";

  let {
    entry$,
    conversationId,
  }: {
    entry$: ObservableItem<LinkedChatEntry>;
    conversationId: string;
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
  {:else if entry.type === "thought"}
    <ThoughtRow {entry} {conversationId} />
  {:else if entry.type === "assistant-message"}
    <AssistantMessageRow {entry} {conversationId} />
  {:else if entry.type === "tool-invocation" && entry.toolId === "todo_write"}
    <TodoWriteRow {entry} />
  {:else if entry.type === "tool-invocation"}
    <ToolRunRow {entry} {conversationId} />
  {:else if entry.type === "checkpoint-summary"}
    <CheckpointSummaryRow {entry} />
  {:else if entry.type === "context-injection"}
    <ContextRow {entry} />
  {/if}
{/if}
