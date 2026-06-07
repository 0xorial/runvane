<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";
  import type { ConversationGroupRow, ConversationRow } from "../../../../backend/src/contracts/conversations";
  import type { ModelPricing } from "@/lib/costEstimation";
  import type { SidebarSection } from "./sidebarSections";
  import ConversationItem from "./ConversationItem.svelte";

  let {
    sections,
    collapsedGroups,
    knownGroups,
    multiSelectMode,
    deletedMode,
    pricingByModel,
    selectedConversationIds,
    onSelect,
    onToggleSelected,
    onRenameConversation,
    onMoveConversationToGroup,
    onSoftDeleteConversation,
    onUndeleteConversation,
    onPermanentlyDeleteConversation,
    onToggleGroup,
  }: {
    sections: SidebarSection[];
    collapsedGroups: Record<string, boolean>;
    knownGroups: ConversationGroupRow[];
    multiSelectMode: boolean;
    deletedMode: boolean;
    pricingByModel: Map<string, ModelPricing>;
    selectedConversationIds: string[];
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
    onToggleGroup: (groupId: string) => void;
  } = $props();
</script>

{#each sections as section (section.kind === "conversation" ? section.row.id : section.groupId)}
  {#if section.kind === "conversation"}
    <ConversationItem
      conversation={section.row}
      {knownGroups}
      {multiSelectMode}
      {deletedMode}
      {pricingByModel}
      selected={selectedConversationIds.includes(section.row.id)}
      {onSelect}
      {onToggleSelected}
      {onRenameConversation}
      {onMoveConversationToGroup}
      {onSoftDeleteConversation}
      {onUndeleteConversation}
      {onPermanentlyDeleteConversation}
    />
  {:else}
    {@const collapsed = collapsedGroups[section.groupId] ?? false}
    <button
      type="button"
      class="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-secondary/40"
      onclick={() => onToggleGroup(section.groupId)}
    >
      <span class="truncate">{section.groupName}</span>
      <span class="ml-2 inline-flex shrink-0 items-center gap-1">
        {#if collapsed}
          <Icon name="chevron-right" class="h-3.5 w-3.5" />
        {:else}
          <Icon name="chevron-down" class="h-3.5 w-3.5" />
        {/if}
        {section.rows.length}
      </span>
    </button>
    {#if !collapsed}
      {#each section.rows as row (row.id)}
        <ConversationItem
          conversation={row}
          nested
          {knownGroups}
          {multiSelectMode}
          {deletedMode}
          {pricingByModel}
          selected={selectedConversationIds.includes(row.id)}
          {onSelect}
          {onToggleSelected}
          {onRenameConversation}
          {onMoveConversationToGroup}
          {onSoftDeleteConversation}
          {onUndeleteConversation}
          {onPermanentlyDeleteConversation}
        />
      {/each}
    {/if}
  {/if}
{/each}
