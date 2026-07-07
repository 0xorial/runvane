<script lang="ts">
  import ChatTranscript from "@/components/chat/ChatTranscript.svelte";
  import ChatComposer from "@/components/chat/ChatComposer.svelte";
  import ChatTitlePanel from "@/components/chat/ChatTitlePanel.svelte";
  import ForkedFromBanner from "@/components/chat/ForkedFromBanner.svelte";
  import ConversationBranchesPanel from "@/components/chat/ConversationBranchesPanel.svelte";
  import ResizablePaneHandle from "@/components/ui/ResizablePaneHandle.svelte";
  import { isThoughtStreamEntry } from "@/protocol/chatEntry";
  import { createChatSessionState } from "@/lib/chatSessionState.svelte";
  import { setChatSessionContext } from "@/lib/chatSessionContext";
  import { resolveLastPlannerLlmOnPath } from "@/lib/resolveLastPlannerLlm";
  import { agentIdFromSearch, chatSearch, navigate, settingsLinkFromSearch } from "@/lib/router";
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

  // Aligning a row to the viewport top is an explicit user event (sending a
  // message, picking a branch anchor) — never derived from transcript state, so
  // loading or switching a conversation can't scroll on its own.
  type AlignAnchor = { id: string; token: number; source: "sent" | "branch" };
  let alignAnchor = $state<AlignAnchor | null>(null);
  let alignSeq = 0;
  let composerTextareaRef = $state<HTMLTextAreaElement | null>(null);
  const selectedAgentId = $derived(agentIdFromSearch(search));
  setChatSessionContext({
    getConversationId: () => conversationId,
    getActivePathEntries: () => session.activePathEntries,
    setActiveLeaf: (entryId) => session.setActiveLeaf(entryId),
    switchToBranch: (branchEntryId) => session.switchToBranch(branchEntryId),
    siblingsOf: (entryId) => session.store.siblingsOf(entryId),
  });

  const activePathEntries = $derived(session.activePathEntries.map((row$) => row$.get()));
  const activePathEntryById = $derived(new Map(activePathEntries.map((entry) => [entry.id, entry])));
  const tripletStreamIdByThoughtId = $derived.by(() => {
    const map = new Map<string, string>();
    for (const entry of activePathEntries) {
      if (isThoughtStreamEntry(entry)) map.set(entry.thoughtId, entry.id);
    }
    return map;
  });

  function resolveVisibleAnchorEntryId(entryId: string): string {
    const selected = activePathEntryById.get(entryId);
    if (!selected) return entryId;
    if (selected.type !== "thought-prepare" && selected.type !== "thought-action") return entryId;
    return tripletStreamIdByThoughtId.get(selected.thoughtId) ?? entryId;
  }

  const pathPlannerLlm = $derived(resolveLastPlannerLlmOnPath(activePathEntries));

  function handleSent(optimisticRowId: string): void {
    alignAnchor = { id: optimisticRowId, token: ++alignSeq, source: "sent" };
  }

  // The optimistic user row is rekeyed to its server id when the SSE ack lands;
  // follow it so an in-flight align (and later spacer upkeep) tracks the row.
  $effect(() => {
    const anchor = alignAnchor;
    if (!anchor || activePathEntryById.has(anchor.id)) return;
    if (anchor.source === "sent") {
      for (let i = activePathEntries.length - 1; i >= 0; i -= 1) {
        if (activePathEntries[i].type === "user-message") {
          alignAnchor = { ...anchor, id: activePathEntries[i].id };
          return;
        }
      }
    }
    alignAnchor = null;
  });

  function openSettings(): void {
    navigate(settingsLinkFromSearch($chatSearch));
  }

  let lastConversationId = $state<string | null | undefined>(undefined);
  $effect(() => {
    const id = conversationId;
    if (id === lastConversationId) return;
    lastConversationId = id;
    alignAnchor = null;
  });

  $effect(() => {
    const id = requestAnimationFrame(() => composerTextareaRef?.focus());
    return () => cancelAnimationFrame(id);
  });

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
  <ForkedFromBanner {conversationId} />
  {#if rightSidebarVisible}
    <PaneGroup direction="horizontal" autoSaveId="chat-right-branches-layout" class="min-h-0 min-w-0 flex-1">
      <Pane minSize={30} class="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <ChatTranscript
          {conversationId}
          entries={session.activePathEntries}
          isSessionLoading={session.isSessionLoading}
          {selectedAgentId}
          anchorEntryId={alignAnchor?.id ?? null}
          alignToken={alignAnchor?.token ?? 0}
        />
        <ChatComposer
          {conversationId}
          {pathPlannerLlm}
          {search}
          pendingMessages={session.pendingMessages}
          appendOptimisticUserMessage={session.appendOptimisticUserMessage}
          onSent={handleSent}
          bind:textareaRef={composerTextareaRef}
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
            onAnchorEntrySelected={(entryId) => {
              alignAnchor = { id: resolveVisibleAnchorEntryId(entryId), token: ++alignSeq, source: "branch" };
            }}
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
        {selectedAgentId}
        anchorEntryId={alignAnchor?.id ?? null}
        alignToken={alignAnchor?.token ?? 0}
      />
      <ChatComposer
        {conversationId}
        {pathPlannerLlm}
        {search}
        pendingMessages={session.pendingMessages}
        appendOptimisticUserMessage={session.appendOptimisticUserMessage}
        onSent={handleSent}
        bind:textareaRef={composerTextareaRef}
      />
    </div>
  {/if}
</div>
