<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";
  import NewGroupDialog from "./NewGroupDialog.svelte";
  import type { ConversationGroupRow } from "../../../../backend/src/contracts/conversations";
  import { renameConversation } from "@/api/client";
  import { notifyError } from "@/utils/toast";

  let {
    selectedConversationIds,
    knownGroups,
    deletedMode,
    reloadConversations,
    onSelectionChange,
    onExpandGroup,
    onDeleteSelected,
  }: {
    selectedConversationIds: string[];
    knownGroups: ConversationGroupRow[];
    deletedMode: boolean;
    reloadConversations: () => Promise<{ groups: ConversationGroupRow[] }>;
    onSelectionChange: (ids: string[]) => void;
    onExpandGroup: (groupId: string) => void;
    onDeleteSelected: () => void | Promise<void>;
  } = $props();

  let moveOpen = $state(false);
  let newGroupDialogOpen = $state(false);
  let newGroupName = $state("");

  async function moveToGroup(groupId: string | null): Promise<void> {
    moveOpen = false;
    try {
      await Promise.all(
        selectedConversationIds.map((id) => renameConversation(id, { groupId })),
      );
      const data = await reloadConversations();
      if (groupId) onExpandGroup(groupId);
      onSelectionChange([]);
      void data;
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createGroupAndMove(): Promise<void> {
    const name = newGroupName.trim();
    if (!name) return;
    moveOpen = false;
    newGroupDialogOpen = false;
    try {
      const firstId = selectedConversationIds[0];
      if (!firstId) return;
      await renameConversation(firstId, { newGroupName: name });
      const data = await reloadConversations();
      const group = data.groups.find((g) => g.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0);
      if (group?.id) {
        const rest = selectedConversationIds.slice(1);
        await Promise.all(rest.map((id) => renameConversation(id, { groupId: group.id })));
        await reloadConversations();
        onExpandGroup(group.id);
      }
      onSelectionChange([]);
      newGroupName = "";
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }
</script>

<div class="flex items-center justify-between border-t border-sidebar-border pt-1 text-xs text-muted-foreground">
  <span>{selectedConversationIds.length} selected</span>
  <div class="relative flex items-center gap-0.5">
    {#if !deletedMode}
      <button type="button" class="rounded px-1.5 py-0.5 hover:bg-secondary/80" onclick={() => (moveOpen = !moveOpen)}>
        Move
      </button>
      {#if moveOpen}
        <div class="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded-md border border-border bg-popover py-1 shadow-md">
          <button type="button" class="block w-full px-3 py-1 text-left text-xs hover:bg-muted" onclick={() => void moveToGroup(null)}>
            No group
          </button>
          {#each knownGroups as group (group.id)}
            <button
              type="button"
              class="block w-full px-3 py-1 text-left text-xs hover:bg-muted"
              onclick={() => void moveToGroup(group.id)}
            >
              {group.name}
            </button>
          {/each}
          <button
            type="button"
            class="block w-full px-3 py-1 text-left text-xs hover:bg-muted"
            onclick={() => {
              moveOpen = false;
              newGroupDialogOpen = true;
            }}
          >
            New group…
          </button>
        </div>
      {/if}
    {/if}
    <button
      type="button"
      aria-label="Delete selected conversations"
      class="inline-flex h-6 w-6 items-center justify-center rounded text-destructive/70"
      onclick={() => void onDeleteSelected()}
    >
      <Icon name="trash" class="h-3.5 w-3.5" />
    </button>
    <button
      type="button"
      aria-label="Exit multi-select mode"
      class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/80"
      onclick={() => onSelectionChange([])}
    >
      <Icon name="x" class="h-3.5 w-3.5" />
    </button>
  </div>
</div>

<NewGroupDialog
  open={newGroupDialogOpen}
  {newGroupName}
  onOpenChange={(open) => {
    newGroupDialogOpen = open;
    if (!open) newGroupName = "";
  }}
  onNewGroupNameChange={(v) => (newGroupName = v)}
  onSubmit={createGroupAndMove}
/>
