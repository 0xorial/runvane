<script lang="ts">
  import { childEntries, type ChatEntryLookup } from "@/lib/linkedChatEntry";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import type { ObservableItem } from "@/utils/observableCollection";
  import { notifyError } from "@/utils/toast";
  import RowIcon from "./RowIcon.svelte";
  import BranchNode from "./branches/BranchNode.svelte";

  let {
    conversationId,
    allEntries,
    activePathEntries,
    switchToBranch,
    onAnchorEntrySelected,
  }: {
    conversationId: string | null;
    allEntries: ObservableItem<LinkedChatEntry>[];
    activePathEntries: ObservableItem<LinkedChatEntry>[];
    switchToBranch: (entryId: string) => Promise<void>;
    onAnchorEntrySelected?: (entryId: string) => void;
  } = $props();

  let switchingToEntryId = $state<string | null>(null);

  const lookup = $derived.by((): ChatEntryLookup => {
    const rows = allEntries.map((row$) => row$.get());
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      getById: (id) => byId.get(id),
      getRows: () => rows,
    };
  });

  const rowById = $derived(new Map(allEntries.map((row$) => [row$.id, row$])));
  const activePathIds = $derived(new Set(activePathEntries.map((row$) => row$.id)));
  const pathTipId = $derived(
    activePathEntries.length > 0 ? activePathEntries[activePathEntries.length - 1].id : null,
  );

  function childRowsOf(parentId: string | null): ObservableItem<LinkedChatEntry>[] {
    return childEntries(lookup, parentId)
      .map((entry) => rowById.get(entry.id))
      .filter((row$): row$ is ObservableItem<LinkedChatEntry> => row$ != null);
  }

  const rootNodes = $derived(childRowsOf(null));

  async function handleSelectEntry(entryId: string): Promise<void> {
    if (!conversationId || switchingToEntryId) return;
    switchingToEntryId = entryId;
    try {
      await switchToBranch(entryId);
      onAnchorEntrySelected?.(entryId);
    } catch (e) {
      notifyError(`Failed to switch branch: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      switchingToEntryId = null;
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col border-l border-border bg-sidebar">
  <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
    {#if !conversationId}
      <p class="p-3 text-xs text-muted-foreground">No conversation selected.</p>
    {:else if rootNodes.length === 0}
      <p class="p-3 text-xs text-muted-foreground">No messages yet.</p>
    {:else}
      <div class="space-y-3 p-3">
        <div class="flex items-center gap-2 px-1">
          <RowIcon name="activity" class="h-4 w-4 text-primary" />
          <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity</h3>
        </div>
        <div class="text-[11px] leading-snug">
          {#each rootNodes as row$ (row$.id)}
            <BranchNode
              entry$={row$}
              branchDepth={0}
              {lookup}
              {childRowsOf}
              {activePathIds}
              {pathTipId}
              {switchingToEntryId}
              onSelectEntry={(id) => void handleSelectEntry(id)}
            />
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>
