<script lang="ts">
  import type { ConversationGroupRow, ConversationRow } from "../../../../backend/src/contracts/conversations";
  import { popupPosition } from "@/lib/popupPosition";
  import { portal } from "@/lib/portal";

  let {
    open,
    anchor,
    conversation,
    deletedMode,
    knownGroups,
    closeMenu,
    renameConversation,
    moveConversationToGroup,
    setGroupPinned,
    softDeleteConversation,
    undeleteConversation,
    permanentlyDeleteConversation,
    openNewGroupDialog,
  }: {
    open: boolean;
    anchor: HTMLButtonElement;
    conversation: ConversationRow;
    deletedMode: boolean;
    knownGroups: ConversationGroupRow[];
    closeMenu: () => void;
    renameConversation: (conversation: ConversationRow) => void | Promise<void>;
    moveConversationToGroup: (
      conversation: ConversationRow,
      target: { groupId?: string | null; newGroupName?: string },
    ) => void | Promise<void>;
    setGroupPinned: (conversation: ConversationRow, pinned: boolean) => void | Promise<void>;
    softDeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    undeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    permanentlyDeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    openNewGroupDialog: () => void;
  } = $props();

  let panel = $state<HTMLDivElement | null>(null);
  let moveSubOpen = $state(false);

  function close(): void {
    moveSubOpen = false;
    closeMenu();
  }

  $effect(() => {
    if (!open) {
      moveSubOpen = false;
      return;
    }
    function onDocMouseDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchor.contains(target) || panel?.contains(target)) return;
      close();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
    };
  });
</script>

{#if open}
  <div
    use:portal
    use:popupPosition={{ anchor, align: "end", gap: 4 }}
    bind:this={panel}
    role="menu"
    tabindex="-1"
    class="fixed z-[1500] flex min-w-[10rem] flex-col overflow-y-auto rounded-md border border-border bg-popover py-1 text-xs shadow-md"
    onmousedown={(e) => e.stopPropagation()}
  >
    {#if deletedMode || conversation.isDeleted}
      <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { close(); void undeleteConversation(conversation); }}>
        Undelete
      </button>
      <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { close(); void permanentlyDeleteConversation(conversation); }}>
        Delete permanently
      </button>
    {:else}
      <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { close(); renameConversation(conversation); }}>
        Rename
      </button>
      <div
        role="group"
        class="relative"
        onmouseenter={() => (moveSubOpen = true)}
        onmouseleave={() => (moveSubOpen = false)}
      >
        <button
          type="button"
          class="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-muted"
          onclick={() => (moveSubOpen = !moveSubOpen)}
        >
          Move to group
          <span class="text-muted-foreground">›</span>
        </button>
        {#if moveSubOpen}
          <div
            role="menu"
            tabindex="-1"
            class="absolute left-full top-0 z-10 ml-0.5 min-w-[10rem] rounded-md border border-border bg-popover py-1 shadow-md"
            onmousedown={(e) => e.stopPropagation()}
          >
            <button
              class="block w-full px-3 py-1.5 text-left hover:bg-muted"
              onclick={() => {
                close();
                void moveConversationToGroup(conversation, { groupId: null });
              }}
            >
              No group
            </button>
            {#each knownGroups as group (group.id)}
              <button
                class="block w-full px-3 py-1.5 text-left hover:bg-muted"
                onclick={() => {
                  close();
                  void moveConversationToGroup(conversation, { groupId: group.id });
                }}
              >
                {group.name}
              </button>
            {/each}
            <button
              class="block w-full px-3 py-1.5 text-left hover:bg-muted"
              onclick={() => {
                close();
                openNewGroupDialog();
              }}
            >
              New group…
            </button>
          </div>
        {/if}
      </div>
      <button
        class="block w-full px-3 py-1.5 text-left hover:bg-muted"
        title={conversation.groupPinned
          ? "Let auto-categorization manage this chat's group again"
          : "Keep this chat in its group; auto-categorization won't move it"}
        onclick={() => { close(); void setGroupPinned(conversation, !conversation.groupPinned); }}
      >
        {conversation.groupPinned ? "Unlock from group" : "Lock to group"}
      </button>
      <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { close(); void softDeleteConversation(conversation); }}>
        Delete
      </button>
    {/if}
  </div>
{/if}
