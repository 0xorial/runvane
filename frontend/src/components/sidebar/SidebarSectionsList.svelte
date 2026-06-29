<script lang="ts">
  import type { ConversationGroupRow, ConversationRow } from "../../../../backend/src/contracts/conversations";
  import type { ModelPricing } from "@/lib/costEstimation";
  import type { SidebarSection } from "./sidebarSections";
  import ConversationGroupItem from "./ConversationGroupItem.svelte";
  import ConversationItem from "./ConversationItem.svelte";

  let {
    sections,
    collapsedGroups,
    knownGroups,
    enableMultiSelect,
    multiSelectMode,
    selectedConversationIdSet,
    deletedMode,
    pricingByModel,
    selectConversation,
    renameConversation,
    moveConversationToGroup,
    setGroupPinned,
    softDeleteConversation,
    undeleteConversation,
    permanentlyDeleteConversation,
    toggleGroup,
  }: {
    sections: SidebarSection[];
    collapsedGroups: Record<string, boolean>;
    knownGroups: ConversationGroupRow[];
    enableMultiSelect: boolean;
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
    setGroupPinned: (conversation: ConversationRow, pinned: boolean) => void | Promise<void>;
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
      {enableMultiSelect}
      {multiSelectMode}
      {deletedMode}
      {pricingByModel}
      {selectConversation}
      {renameConversation}
      {moveConversationToGroup}
      {setGroupPinned}
      {softDeleteConversation}
      {undeleteConversation}
      {permanentlyDeleteConversation}
    />
  {:else}
    {@const collapsed = collapsedGroups[section.groupId] ?? false}
    <ConversationGroupItem
      groupId={section.groupId}
      groupName={section.groupName}
      rowCount={section.totalCount}
      shownCount={section.rows.length}
      latestTimestampIso={section.latestTimestampIso}
      {collapsed}
      onToggle={toggleGroup}
    >
      {#each section.rows as row (row.id)}
        <ConversationItem
          conversation={row}
          selected={selectedConversationIdSet.has(row.id)}
          nested
          {knownGroups}
          {enableMultiSelect}
          {multiSelectMode}
          {deletedMode}
          {pricingByModel}
          {selectConversation}
          {renameConversation}
          {moveConversationToGroup}
          {setGroupPinned}
          {softDeleteConversation}
          {undeleteConversation}
          {permanentlyDeleteConversation}
        />
      {/each}
    </ConversationGroupItem>
  {/if}
{/each}
