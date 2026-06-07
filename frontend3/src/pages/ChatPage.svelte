<script lang="ts">
  import ChatTranscript from "@/components/chat/ChatTranscript.svelte";
  import ChatComposer from "@/components/chat/ChatComposer.svelte";
  import ChatTitlePanel from "@/components/chat/ChatTitlePanel.svelte";
  import ConversationBranchesPanel from "@/components/chat/ConversationBranchesPanel.svelte";
  import ResizablePaneHandle from "@/components/ui/ResizablePaneHandle.svelte";
  import { createChatSessionState } from "@/lib/chatSessionState.svelte";
  import { setChatSessionContext, type ThoughtStage } from "@/lib/chatSessionContext";
  import { chatSearch, navigate, settingsLinkFromSearch } from "@/lib/router";
  import { Pane, PaneGroup } from "paneforge";

  let {
    conversationId,
    search,
    sidebarVisible,
    onToggleSidebar,
    rightSidebarVisible,
    onToggleRightSidebar,
    settingsPressed,
  }: {
    conversationId: string | null;
    search: string;
    sidebarVisible: boolean;
    onToggleSidebar: () => void;
    rightSidebarVisible: boolean;
    onToggleRightSidebar: () => void;
    settingsPressed: boolean;
  } = $props();

  const session = createChatSessionState(() => conversationId);

  let expandedStageBySlotKey = $state(new Map<string, ThoughtStage>());
  let expandedStageVersion = $state(0);

  setChatSessionContext({
    getConversationId: () => conversationId,
    getActivePathEntries: () => session.activePathEntries,
    setActiveLeaf: (entryId) => session.setActiveLeaf(entryId),
    switchToBranch: (branchEntryId) => session.switchToBranch(branchEntryId),
    siblingsOf: (entryId) => session.store.siblingsOf(entryId),
    getExpandedStage: (slotKey) => expandedStageBySlotKey.get(slotKey) ?? null,
    getExpandedStageVersion: () => expandedStageVersion,
    setSlotExpandedStage: (slotKey, stage) => {
      const next = new Map(expandedStageBySlotKey);
      if (stage === null) next.delete(slotKey);
      else next.set(slotKey, stage);
      expandedStageBySlotKey = next;
      expandedStageVersion += 1;
    },
    resetExpandedStages: () => {
      expandedStageBySlotKey = new Map();
      expandedStageVersion += 1;
    },
  });

  $effect(() => {
    void conversationId;
    expandedStageBySlotKey = new Map();
    expandedStageVersion += 1;
  });

  function openSettings(): void {
    navigate(settingsLinkFromSearch($chatSearch));
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <ChatTitlePanel
    {conversationId}
    {sidebarVisible}
    {onToggleSidebar}
    {rightSidebarVisible}
    {onToggleRightSidebar}
    onOpenSettings={openSettings}
    {settingsPressed}
  />
  {#if rightSidebarVisible}
    <PaneGroup
      direction="horizontal"
      autoSaveId="chat-right-branches-layout"
      class="min-h-0 min-w-0 flex-1"
    >
      <Pane minSize={30} class="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <ChatTranscript
          {conversationId}
          entries={session.activePathEntries}
          isSessionLoading={session.isSessionLoading}
        />
        <ChatComposer
          {conversationId}
          {search}
          pendingMessages={session.pendingMessages}
          appendOptimisticUserMessage={session.appendOptimisticUserMessage}
        />
      </Pane>
      <ResizablePaneHandle withHandle />
      <Pane defaultSize={26} minSize={16} maxSize={45} class="min-h-0 min-w-0 overflow-hidden">
        <aside class="h-full min-h-0 overflow-y-auto border-l border-border bg-sidebar">
          <ConversationBranchesPanel
            {conversationId}
            allEntries={session.allEntries}
            activePathEntries={session.activePathEntries}
            switchToBranch={session.switchToBranch}
          />
        </aside>
      </Pane>
    </PaneGroup>
  {:else}
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatTranscript
        {conversationId}
        entries={session.activePathEntries}
        isSessionLoading={session.isSessionLoading}
      />
      <ChatComposer
        {conversationId}
        {search}
        pendingMessages={session.pendingMessages}
        appendOptimisticUserMessage={session.appendOptimisticUserMessage}
      />
    </div>
  {/if}
</div>
