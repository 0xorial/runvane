<script lang="ts">
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import { buildThoughtTripletsById, visibleTranscriptEntries } from "@/lib/thoughtTriplets";
  import ObservableEntry from "./ObservableEntry.svelte";

  let {
    conversationId,
    entries,
    isSessionLoading,
  }: {
    conversationId: string | null;
    entries: ObservableItem<LinkedChatEntry>[];
    isSessionLoading: boolean;
  } = $props();

  const thoughtTripletsById = $derived(buildThoughtTripletsById(entries));
  const visibleEntries = $derived(visibleTranscriptEntries(entries));
</script>

<div
  data-testid="chat-transcript"
  class="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden"
>
  {#if conversationId && visibleEntries.length > 0}
    {#each visibleEntries as entry$ (entry$.id)}
      <ObservableEntry {entry$} {conversationId} {thoughtTripletsById} />
    {/each}
  {:else if conversationId && isSessionLoading}
    <div
      data-testid="chat-loading"
      class="flex min-h-[12rem] flex-1 items-center justify-center p-8 text-muted-foreground"
    >
      Loading…
    </div>
  {:else}
    <p class="p-8 text-center text-sm text-muted-foreground">Start a conversation</p>
  {/if}
</div>
