<script lang="ts">
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { ChatEntry } from "@/protocol/chatEntry";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import ChatMessageRow from "./ChatMessageRow.svelte";

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
  <div
    data-chat-entry-id={entry.id}
    data-chat-entry-type={entry.type}
    data-chat-prepare-title={entry.type === "thought-prepare" ? (entry.title ?? "") : undefined}
  >
    <ChatMessageRow {entry} {conversationId} />
  </div>
{/if}
