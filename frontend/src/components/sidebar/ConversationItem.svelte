<script lang="ts">
  import type { ConversationGroupRow, ConversationRow } from "../../../../backend/src/contracts/conversations";
  import ConversationCostDisplay from "@/components/chat/ConversationCostDisplay.svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import { toggleConversationSelected } from "@/lib/conversationMultiSelect.svelte";
  import { type ModelPricing } from "@/lib/costEstimation";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";
  import ConversationRowMenu from "./ConversationRowMenu.svelte";
  import NewGroupDialog from "./NewGroupDialog.svelte";

  let {
    conversation,
    nested = false,
    knownGroups,
    selected,
    multiSelectMode,
    deletedMode,
    pricingByModel,
    selectConversation,
    renameConversation,
    moveConversationToGroup,
    setGroupPinned,
    softDeleteConversation,
    undeleteConversation,
    permanentlyDeleteConversation,
  }: {
    conversation: ConversationRow;
    nested?: boolean;
    knownGroups: ConversationGroupRow[];
    selected: boolean;
    multiSelectMode: boolean;
    deletedMode: boolean;
    pricingByModel: Map<string, ModelPricing>;
    selectConversation: (id: string) => void;
    renameConversation: (conversation: ConversationRow) => void | Promise<void>;
    moveConversationToGroup: (
      conversation: ConversationRow,
      target: { groupId?: string | null; newGroupName?: string },
    ) => void | Promise<void>;
    setGroupPinned: (conversation: ConversationRow, pinned: boolean) => void | Promise<void>;
    softDeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    undeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    permanentlyDeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
  } = $props();

  let menuOpen = $state(false);
  let menuAnchor = $state<HTMLButtonElement | null>(null);
  let moveDialogOpen = $state(false);
  let newGroupName = $state("");

  const timestampIso = $derived(
    conversation.lastMessageAt || conversation.createdAt || conversation.updatedAt,
  );
  const stamp = $derived(formatRelativeChatTime(timestampIso));
  const stampExact = $derived(formatExactChatTime(timestampIso));

  async function submitNewGroupDialog(): Promise<void> {
    const groupName = newGroupName.trim();
    if (!groupName) return;
    await moveConversationToGroup(conversation, { newGroupName: groupName });
    moveDialogOpen = false;
    newGroupName = "";
  }
</script>

<div
  data-conversation-row
  data-conversation-id={conversation.id}
  data-active="false"
  class="group/row flex w-full shrink-0 items-stretch overflow-hidden rounded-md text-xs text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground data-[active=true]:bg-secondary data-[active=true]:text-foreground {nested
    ? 'ml-3'
    : ''}"
>
  <div class="flex w-6 shrink-0 items-center justify-center">
    <input
      type="checkbox"
      data-testid={`sidebar-select-${conversation.id}`}
      class="h-4 w-4 {multiSelectMode ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}"
      checked={selected}
      aria-label={`Select conversation ${conversation.title || conversation.id}`}
      onchange={(event) => {
        event.stopPropagation();
        toggleConversationSelected(conversation.id, event.currentTarget.checked);
      }}
    />
  </div>
  <button
    type="button"
    data-testid={`sidebar-conversation-${conversation.id}`}
    class="min-w-0 flex-1 py-2 pl-0.5 pr-2.5 text-left"
    onclick={() => {
      if (multiSelectMode) toggleConversationSelected(conversation.id, !selected);
      else selectConversation(conversation.id);
    }}
  >
    <div class="flex items-center gap-2">
      <Icon name="message-square" class="h-3 w-3 shrink-0" />
      <span class="truncate font-medium text-foreground/90 group-hover/row:text-foreground">
        {conversation.title || "Untitled"}
      </span>
      {#if conversation.groupPinned}
        <Icon name="lock" class="h-3 w-3 shrink-0 text-muted-foreground" />
      {/if}
    </div>
    {#if stamp}
      <span class="ml-5.5 mt-0.5 block truncate text-[10px] text-muted-foreground" title={stampExact}>{stamp}</span>
    {/if}
    <ConversationCostDisplay
      usageByModel={conversation.tokenUsageByModel ?? []}
      {pricingByModel}
      class="ml-5.5 mt-0.5 bg-transparent px-0 py-0 text-[10px]"
    />
  </button>
  {#if !multiSelectMode}
    <button
      bind:this={menuAnchor}
      type="button"
      class="inline-flex h-auto w-7 shrink-0 items-center justify-center rounded-none text-muted-foreground opacity-60 hover:bg-secondary/80 hover:text-foreground group-hover/row:opacity-100"
      aria-label="Chat menu"
      aria-expanded={menuOpen}
      onclick={(e) => {
        e.stopPropagation();
        menuOpen = !menuOpen;
      }}
    >
      <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
      </svg>
    </button>
    {#if menuAnchor}
      <ConversationRowMenu
        open={menuOpen}
        anchor={menuAnchor}
        {conversation}
        {deletedMode}
        {knownGroups}
        closeMenu={() => (menuOpen = false)}
        {renameConversation}
        {moveConversationToGroup}
        {setGroupPinned}
        {softDeleteConversation}
        {undeleteConversation}
        {permanentlyDeleteConversation}
        openNewGroupDialog={() => (moveDialogOpen = true)}
      />
    {/if}
  {/if}
</div>

<NewGroupDialog
  open={moveDialogOpen}
  {newGroupName}
  onOpenChange={(open) => {
    moveDialogOpen = open;
    if (!open) newGroupName = "";
  }}
  onNewGroupNameChange={(v) => (newGroupName = v)}
  onSubmit={submitNewGroupDialog}
/>
