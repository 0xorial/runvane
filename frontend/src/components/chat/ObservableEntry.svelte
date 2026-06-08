<script lang="ts">
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import type { ThoughtTripletRefs } from "@/lib/thoughtTriplets";
  import ChatMessageRow from "./ChatMessageRow.svelte";

  let {
    entry$,
    conversationId,
    thoughtTripletsById,
  }: {
    entry$: ObservableItem<LinkedChatEntry>;
    conversationId: string;
    thoughtTripletsById: ReadonlyMap<string, ThoughtTripletRefs>;
  } = $props();

  const entry = $derived(entry$.get());
</script>

<div
  data-chat-entry-id={entry.id}
  data-chat-entry-type={entry.type}
  data-chat-prepare-title={entry.type === "thought-prepare" ? (entry.title ?? "") : undefined}
>
  <ChatMessageRow {entry$} {conversationId} {thoughtTripletsById} />
</div>
