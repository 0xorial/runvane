<script lang="ts">
  import type { ConversationGroupRow, ConversationRow } from "../../../../backend/src/contracts/conversations";
  import { TokenUsageMapper } from "../../../../backend/src/contracts/token-usage";
  import LlmMetaBadge from "@/components/chat/LlmMetaBadge.svelte";
  import { estimateConversationCostUsd, type ModelPricing } from "@/lib/costEstimation";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";
  import NewGroupDialog from "./NewGroupDialog.svelte";

  let {
    conversation,
    nested = false,
    knownGroups,
    multiSelectMode,
    deletedMode,
    pricingByModel,
    selected,
    onSelect,
    onToggleSelected,
    onRenameConversation,
    onMoveConversationToGroup,
    onSoftDeleteConversation,
    onUndeleteConversation,
    onPermanentlyDeleteConversation,
  }: {
    conversation: ConversationRow;
    nested?: boolean;
    knownGroups: ConversationGroupRow[];
    multiSelectMode: boolean;
    deletedMode: boolean;
    pricingByModel: Map<string, ModelPricing>;
    selected: boolean;
    onSelect: (id: string) => void;
    onToggleSelected: (id: string, checked: boolean) => void;
    onRenameConversation: (conversation: ConversationRow) => void | Promise<void>;
    onMoveConversationToGroup: (
      conversation: ConversationRow,
      target: { groupId?: string | null; newGroupName?: string },
    ) => void | Promise<void>;
    onSoftDeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    onUndeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    onPermanentlyDeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
  } = $props();

  let menuOpen = $state(false);
  let moveDialogOpen = $state(false);
  let newGroupName = $state("");

  const timestampIso = $derived(
    conversation.lastMessageAt || conversation.createdAt || conversation.updatedAt,
  );
  const stamp = $derived(formatRelativeChatTime(timestampIso));
  const stampExact = $derived(formatExactChatTime(timestampIso));
  const usage = $derived(TokenUsageMapper.fromConversationTotals(conversation));
  const estimatedCostUsd = $derived(
    estimateConversationCostUsd(conversation.tokenUsageByModel ?? [], pricingByModel),
  );

  async function submitNewGroupDialog(): Promise<void> {
    const groupName = newGroupName.trim();
    if (!groupName) return;
    await onMoveConversationToGroup(conversation, { newGroupName: groupName });
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
      class="h-4 w-4 {multiSelectMode ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}"
      checked={selected}
      aria-label={`Select conversation ${conversation.title || conversation.id}`}
      onclick={(e) => e.stopPropagation()}
      onchange={(e) => onToggleSelected(conversation.id, e.currentTarget.checked)}
    />
  </div>
  <button
    type="button"
    data-testid={`sidebar-conversation-${conversation.id}`}
    class="min-w-0 flex-1 py-2 pl-0.5 pr-2.5 text-left"
    onclick={() => {
      if (multiSelectMode) onToggleSelected(conversation.id, !selected);
      else onSelect(conversation.id);
    }}
  >
    <span class="block truncate font-medium text-foreground/90 group-hover/row:text-foreground">
      {conversation.title || "Untitled"}
    </span>
    {#if stamp}
      <span class="mt-0.5 block truncate text-[10px] text-muted-foreground" title={stampExact}>{stamp}</span>
    {/if}
    <LlmMetaBadge
      {usage}
      showTokenBreakdown
      {estimatedCostUsd}
      class="mt-0.5 bg-transparent px-0 py-0 text-[10px]"
    />
  </button>
  {#if !multiSelectMode}
    <div class="relative">
      <button
        type="button"
        class="inline-flex h-auto w-7 shrink-0 items-center justify-center rounded-none text-muted-foreground opacity-60 hover:bg-secondary/80 hover:text-foreground group-hover/row:opacity-100"
        aria-label="Chat menu"
        onclick={(e) => {
          e.stopPropagation();
          menuOpen = !menuOpen;
        }}
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
        </svg>
      </button>
      {#if menuOpen}
        <div
          role="menu"
          tabindex="-1"
          class="absolute right-0 top-full z-30 min-w-[10rem] rounded-md border border-border bg-popover py-1 text-xs shadow-md"
          onmousedown={(e) => e.stopPropagation()}
        >
          {#if deletedMode || conversation.isDeleted}
            <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { menuOpen = false; void onUndeleteConversation(conversation); }}>
              Undelete
            </button>
            <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { menuOpen = false; void onPermanentlyDeleteConversation(conversation); }}>
              Delete permanently
            </button>
          {:else}
            <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { menuOpen = false; void onRenameConversation(conversation); }}>
              Rename
            </button>
            <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { menuOpen = false; void onMoveConversationToGroup(conversation, { groupId: null }); }}>
              Move: No group
            </button>
            {#each knownGroups as group (group.id)}
              <button
                class="block w-full px-3 py-1.5 text-left hover:bg-muted"
                onclick={() => { menuOpen = false; void onMoveConversationToGroup(conversation, { groupId: group.id }); }}
              >
                Move: {group.name}
              </button>
            {/each}
            <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { menuOpen = false; moveDialogOpen = true; }}>
              New group…
            </button>
            <button class="block w-full px-3 py-1.5 text-left hover:bg-muted" onclick={() => { menuOpen = false; void onSoftDeleteConversation(conversation); }}>
              Delete
            </button>
          {/if}
        </div>
      {/if}
    </div>
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
