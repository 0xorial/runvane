<script lang="ts">
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import AnchorTopScrollArea from "@/components/ui/AnchorTopScrollArea.svelte";
  import Spinner from "@/components/ui/Spinner.svelte";
  import AgentCardsEmptyState from "./AgentCardsEmptyState.svelte";
  import ObservableEntry from "./ObservableEntry.svelte";

  let {
    conversationId,
    entries,
    isSessionLoading,
    selectedAgentId = "",
    anchorEntryId = null,
    alignToken = 0,
  }: {
    conversationId: string | null;
    entries: ObservableItem<LinkedChatEntry>[];
    isSessionLoading: boolean;
    selectedAgentId?: string;
    anchorEntryId?: string | null;
    alignToken?: number;
  } = $props();

  const visibleEntries = $derived(entries);
</script>

<AnchorTopScrollArea
  {anchorEntryId}
  {alignToken}
  resetKey={conversationId}
  testId="chat-transcript"
  class="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden"
>
  {#snippet children()}
    {#if conversationId && visibleEntries.length > 0}
      {#each visibleEntries as entry$ (entry$.id)}
        <ObservableEntry {entry$} {conversationId} />
      {/each}
    {:else if conversationId && isSessionLoading && visibleEntries.length === 0}
      <div data-testid="chat-loading" class="flex min-h-[12rem] flex-1 items-center justify-center p-8">
        <Spinner size={16} />
      </div>
    {:else}
      <AgentCardsEmptyState {selectedAgentId} />
    {/if}
  {/snippet}
</AnchorTopScrollArea>
