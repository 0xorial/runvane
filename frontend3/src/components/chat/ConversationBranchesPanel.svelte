<script lang="ts">
  import { isThoughtStreamEntry, type ChatEntry } from "@/protocol/chatEntry";
  import type { ChatSessionStore } from "@/lib/chatSessionStore";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import type { ObservableItem } from "@/utils/observableCollection";
  import { notifyError } from "@/utils/toast";

  let {
    sessionStore,
    allEntries,
    activePathEntries,
    switchToBranch,
    onAnchorEntrySelected,
  }: {
    sessionStore: ChatSessionStore;
    allEntries: ObservableItem<LinkedChatEntry>[];
    activePathEntries: ObservableItem<LinkedChatEntry>[];
    switchToBranch: (entryId: string) => Promise<void>;
    onAnchorEntrySelected?: (entryId: string) => void;
  } = $props();

  let switchingToEntryId = $state<string | null>(null);

  const activePathIds = $derived(new Set(activePathEntries.map((row$) => row$.id)));
  const rowById = $derived(new Map(allEntries.map((row$) => [row$.id, row$])));

  function childRows(parentId: string | null): ObservableItem<LinkedChatEntry>[] {
    return sessionStore
      .childEntries(parentId)
      .map((entry) => rowById.get(entry.id))
      .filter((row$): row$ is ObservableItem<LinkedChatEntry> => row$ != null);
  }

  function entryPreview(entry: ChatEntry): string {
    if (entry.type === "user-message" || entry.type === "assistant-message") {
      const text = entry.text.trim();
      return text.length > 0 ? text : "(empty message)";
    }
    if (entry.type === "tool-invocation") return `Tool: ${entry.toolId || "unknown"}`;
    if (entry.type === "thought-prepare") return String(entry.title || "").trim() || "(context)";
    if (isThoughtStreamEntry(entry)) return String(entry.llm?.model || "").trim() || "stream";
    if (entry.type === "thought-action") return "Decided";
    if (entry.type === "checkpoint-summary") return "Summary";
    return String((entry as ChatEntry).type);
  }

  async function selectEntry(entryId: string): Promise<void> {
    if (switchingToEntryId) return;
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
  <div class="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">Activity</div>
  <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2 text-xs">
    {#if allEntries.length === 0}
      <p class="px-2 py-4 text-muted-foreground">No messages yet.</p>
    {:else}
      {@render branchList(null, 0)}
    {/if}
  </div>
</div>

{#snippet branchList(parentId: string | null, depth: number)}
  {#each childRows(parentId) as row$ (row$.id)}
    {@const entry = row$.get()}
    {@const active = activePathIds.has(entry.id)}
    <button
      type="button"
      class="mb-0.5 flex w-full items-start gap-1 rounded px-1 py-0.5 text-left hover:bg-secondary/50 {active
        ? 'bg-secondary text-foreground'
        : 'text-muted-foreground'}"
      style={`padding-left: ${depth * 12 + 4}px`}
      disabled={switchingToEntryId === entry.id}
      onclick={() => void selectEntry(entry.id)}
    >
      <span class="shrink-0 opacity-60">•</span>
      <span class="min-w-0 truncate">{entryPreview(entry)}</span>
    </button>
    {@render branchList(entry.id, depth + 1)}
  {/each}
{/snippet}
