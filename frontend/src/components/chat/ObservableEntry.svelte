<script lang="ts">
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import ChatMessageRow from "./ChatMessageRow.svelte";

  let {
    entry$,
    conversationId,
  }: {
    entry$: ObservableItem<LinkedChatEntry>;
    conversationId: string;
  } = $props();

  const entry = $derived(entry$.get());
</script>

<div
  data-chat-entry-id={entry.id}
  data-chat-entry-type={entry.type}
  data-chat-thought-title={entry.type === "thought" ? (entry.title ?? "") : undefined}
>
  <ChatMessageRow {entry$} {conversationId} />
</div>
