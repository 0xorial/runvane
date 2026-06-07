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
  let moveSubOpen = $state(false);
  let newGroupDialogOpen = $state(false);
  let newGroupName = $state("");
  let root = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!moveOpen) {
      moveSubOpen = false;
      return;
    }
    function onDocMouseDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node) || !root?.contains(target)) moveOpen = false;
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  });

  async function moveSelected(target: { groupId?: string | null; newGroupName?: string }): Promise<void> {
    moveOpen = false;
    moveSubOpen = false;
    if (selectedConversationIds.length === 0) return;

    const requestBody = {
      groupId: Object.prototype.hasOwnProperty.call(target, "groupId") ? (target.groupId ?? null) : undefined,
      newGroupName: Object.prototype.hasOwnProperty.call(target, "newGroupName")
        ? String(target.newGroupName ?? "")
        : undefined,
    };

    try {
      const results = await Promise.allSettled(
        selectedConversationIds.map((id) => renameConversation(id, requestBody)),
      );
      const failedIds: string[] = [];
      let firstReason = "";
      results.forEach((result, index) => {
        if (result.status === "fulfilled") return;
        failedIds.push(selectedConversationIds[index]);
        if (!firstReason) {
          firstReason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        }
      });

      const data = await reloadConversations();
      if (failedIds.length > 0) {
        onSelectionChange(failedIds);
        notifyError(
          `Moved ${selectedConversationIds.length - failedIds.length}/${selectedConversationIds.length}. ${firstReason}`,
        );
        return;
      }

      onSelectionChange([]);
      const targetGroupId = target.groupId;
      if (typeof targetGroupId === "string" && targetGroupId.trim()) {
        onExpandGroup(targetGroupId);
        return;
      }
      if (target.newGroupName) {
        const nextGroup = data.groups.find(
          (group) =>
            group.name.localeCompare(target.newGroupName || "", undefined, { sensitivity: "base" }) === 0,
        );
        if (nextGroup?.id) onExpandGroup(nextGroup.id);
      }
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createGroupAndMove(): Promise<void> {
    const name = newGroupName.trim();
    if (!name) return;
    newGroupDialogOpen = false;
    newGroupName = "";
    await moveSelected({ newGroupName: name });
  }
</script>

<div class="flex items-center justify-between border-t border-sidebar-border pt-1 text-xs text-muted-foreground">
  <span>{selectedConversationIds.length} selected</span>
  <div class="relative flex items-center gap-0.5" bind:this={root}>
    {#if !deletedMode}
      <button
        type="button"
        aria-label="Move selected conversations"
        title="Move selected conversations"
        class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
        onclick={() => (moveOpen = !moveOpen)}
      >
        <Icon name="folder-input" class="h-3.5 w-3.5" />
      </button>
      {#if moveOpen}
        <div
          role="menu"
          tabindex="-1"
          class="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded-md border border-border bg-popover py-1 shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            class="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
            onclick={() => void moveSelected({ groupId: null })}
          >
            No group
          </button>
          <div
            role="group"
            class="relative"
            onmouseenter={() => (moveSubOpen = true)}
            onmouseleave={() => (moveSubOpen = false)}
          >
            <button
              type="button"
              class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-muted"
              onclick={() => (moveSubOpen = !moveSubOpen)}
            >
              Move to group
              <span class="text-muted-foreground">›</span>
            </button>
            {#if moveSubOpen}
              <div
                role="menu"
                tabindex="-1"
                class="absolute right-full top-0 z-30 mr-0.5 min-w-[10rem] rounded-md border border-border bg-popover py-1 shadow-md"
              >
                {#each knownGroups as group (group.id)}
                  <button
                    type="button"
                    role="menuitem"
                    class="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                    onclick={() => void moveSelected({ groupId: group.id })}
                  >
                    {group.name}
                  </button>
                {/each}
                <button
                  type="button"
                  role="menuitem"
                  class="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
                  onclick={() => {
                    moveOpen = false;
                    moveSubOpen = false;
                    newGroupDialogOpen = true;
                  }}
                >
                  New group…
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
    <button
      type="button"
      aria-label="Delete selected conversations"
      class="inline-flex h-6 w-6 items-center justify-center rounded text-destructive/70 hover:bg-destructive/10"
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
