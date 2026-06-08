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
    selectedConversationIdSet,
    deletedMode,
    pricingByModel,
    selectConversation,
    renameConversation,
    moveConversationToGroup,
    softDeleteConversation,
    undeleteConversation,
    permanentlyDeleteConversation,
    toggleGroup,
  }: {
    sections: SidebarSection[];
    collapsedGroups: Record<string, boolean>;
    knownGroups: ConversationGroupRow[];
    multiSelectMode: boolean;
    selectedConversationIdSet: Set<string>;
    deletedMode: boolean;
    pricingByModel: Map<string, ModelPricing>;
    selectConversation: (id: string) => void;
    renameConversation: (conversation: ConversationRow) => void | Promise<void>;
    moveConversationToGroup: (
      conversation: ConversationRow,
      target: { groupId?: string | null; newGroupName?: string },
    ) => void | Promise<void>;
    softDeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    undeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    permanentlyDeleteConversation: (conversation: ConversationRow) => void | Promise<void>;
    toggleGroup: (groupId: string) => void;
  } = $props();
</script>

{#each sections as section (section.kind === "conversation" ? section.row.id : section.groupId)}
  {#if section.kind === "conversation"}
    <ConversationItem
      conversation={section.row}
      selected={selectedConversationIdSet.has(section.row.id)}
      {knownGroups}
      {multiSelectMode}
      {deletedMode}
      {pricingByModel}
      {selectConversation}
      {renameConversation}
      {moveConversationToGroup}
      {softDeleteConversation}
      {undeleteConversation}
      {permanentlyDeleteConversation}
    />
  {:else}
    {@const collapsed = collapsedGroups[section.groupId] ?? false}
    <button
      type="button"
      class="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-secondary/40"
      onclick={() => toggleGroup(section.groupId)}
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
          selected={selectedConversationIdSet.has(row.id)}
          nested
          {knownGroups}
          {multiSelectMode}
          {deletedMode}
          {pricingByModel}
          {selectConversation}
          {renameConversation}
          {moveConversationToGroup}
          {softDeleteConversation}
          {undeleteConversation}
          {permanentlyDeleteConversation}
        />
      {/each}
    {/if}
  {/if}
{/each}
