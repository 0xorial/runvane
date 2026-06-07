<script lang="ts">
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import { buildThoughtTripletsById, visibleTranscriptEntries } from "@/lib/thoughtTriplets";
  import AnchorTopScrollArea from "@/components/ui/AnchorTopScrollArea.svelte";
  import Spinner from "@/components/ui/Spinner.svelte";
  import AgentCardsEmptyState from "./AgentCardsEmptyState.svelte";
  import ObservableEntry from "./ObservableEntry.svelte";

  let {
    conversationId,
    entries,
    isSessionLoading,
    selectedAgentId = "",
    topAnchorEntryId = null,
  }: {
    conversationId: string | null;
    entries: ObservableItem<LinkedChatEntry>[];
    isSessionLoading: boolean;
    selectedAgentId?: string;
    topAnchorEntryId?: string | null;
  } = $props();

  const thoughtTripletsById = $derived(buildThoughtTripletsById(entries));
  const visibleEntries = $derived(visibleTranscriptEntries(entries));
</script>

<AnchorTopScrollArea
  topAnchorEntryId={topAnchorEntryId}
  testId="chat-transcript"
  class="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden"
>
  {#snippet children()}
    {#if conversationId && visibleEntries.length > 0}
      {#each visibleEntries as entry$ (entry$.id)}
        <ObservableEntry {entry$} {conversationId} {thoughtTripletsById} />
      {/each}
    {:else if conversationId && isSessionLoading}
      <div data-testid="chat-loading" class="flex min-h-[12rem] flex-1 items-center justify-center p-8">
        <Spinner size={24} />
      </div>
    {:else if !conversationId}
      <AgentCardsEmptyState {selectedAgentId} />
    {:else}
      <AgentCardsEmptyState {selectedAgentId} />
    {/if}
  {/snippet}
</AnchorTopScrollArea>
