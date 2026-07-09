<script lang="ts">
  import ChatTranscript from "@/components/chat/ChatTranscript.svelte";
  import ChatComposer from "@/components/chat/ChatComposer.svelte";
  import TodoListPanel from "@/components/chat/TodoListPanel.svelte";
  import ChatTitlePanel from "@/components/chat/ChatTitlePanel.svelte";
  import ForkedFromBanner from "@/components/chat/ForkedFromBanner.svelte";
  import ConversationBranchesPanel from "@/components/chat/ConversationBranchesPanel.svelte";
  import EntryDetailPanel from "@/components/chat/EntryDetailPanel.svelte";
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
    onShowRightSidebar,
    settingsPressed,
  }: {
    conversationId: string | null;
    search: string;
    sidebarVisible: boolean;
    onToggleSidebar: () => void;
    rightSidebarVisible: boolean;
    onToggleRightSidebar: () => void;
    onShowRightSidebar: () => void;
    settingsPressed: boolean;
  } = $props();

  const session = createChatSessionState(() => conversationId);

  // Aligning a row to the viewport top is an explicit user event (sending a
  // message, picking a branch anchor) — never derived from transcript state, so
  // loading or switching a conversation can't scroll on its own. The anchor is
  // tagged with its conversation so a send that CREATES the conversation
  // survives the navigation that follows it.
  type AlignAnchor = { id: string; conversationId: string; token: number; source: "sent" | "branch" };
  let alignAnchor = $state<AlignAnchor | null>(null);
  let alignSeq = 0;
  let composerTextareaRef = $state<HTMLTextAreaElement | null>(null);
  const selectedAgentId = $derived(agentIdFromSearch(search));
  // Collapsed transcript rows (finished thoughts/tools) open their full
  // details in the right pane, sharing it with the branches panel.
  let detailEntryId = $state<string | null>(null);
  setChatSessionContext({
    getConversationId: () => conversationId,
    getActivePathEntries: () => session.activePathEntries,
    setActiveLeaf: (entryId) => session.setActiveLeaf(entryId),
    switchToBranch: (branchEntryId) => session.switchToBranch(branchEntryId),
    siblingsOf: (entryId) => session.store.siblingsOf(entryId),
    toggleEntryDetail: (entryId) => {
      detailEntryId = effectiveDetailEntryId === entryId ? null : entryId;
      if (detailEntryId) onShowRightSidebar();
    },
    getOpenDetailEntryId: () => effectiveDetailEntryId,
  });

  const activePathEntries = $derived(session.activePathEntries.map((row$) => row$.get()));
  const activePathEntryById = $derived(new Map(activePathEntries.map((entry) => [entry.id, entry])));

  // A branch switch can take the selected row's subtree off the active path
  // (context reprocess, try-model, selector paging). The selection then
  // follows to the sibling chosen at the same fork — same parent, same type —
  // and closes when nothing equivalent remains, so the panel never points at
  // an off-path entry.
  const effectiveDetailEntryId = $derived.by(() => {
    const id = detailEntryId;
    if (!id || activePathEntryById.has(id)) return id;
    const selected = session.allEntries.find((row$) => row$.id === id)?.get();
    if (!selected || selected.isSide) return null;
    const replacement = activePathEntries.find(
      (entry) => entry.parentId === selected.parentId && entry.type === selected.type && !entry.isSide,
    );
    return replacement ? replacement.id : null;
  });
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

  function handleSent(sentRowId: string, sentConversationId: string): void {
    alignAnchor = { id: sentRowId, conversationId: sentConversationId, token: ++alignSeq, source: "sent" };
  }

  // A sent anchor starts as an optimistic (or, for a send that created the
  // conversation, placeholder) id and resolves to the server row once the SSE
  // ack lands — follow it so the align tracks the real transcript row.
  $effect(() => {
    const anchor = alignAnchor;
    if (!anchor || anchor.conversationId !== conversationId) return;
    if (activePathEntryById.has(anchor.id)) return;
    if (anchor.source === "sent") {
      for (let i = activePathEntries.length - 1; i >= 0; i -= 1) {
        if (activePathEntries[i].type === "user-message") {
          alignAnchor = { ...anchor, id: activePathEntries[i].id };
          return;
        }
      }
      return; // the sent row hasn't streamed in yet — keep waiting
    }
    alignAnchor = null; // branch anchor left the active path
  });

  function openSettings(): void {
    navigate(settingsLinkFromSearch($chatSearch));
  }

  let lastConversationId = $state<string | null | undefined>(undefined);
  $effect(() => {
    const id = conversationId;
    if (id === lastConversationId) return;
    lastConversationId = id;
    if (alignAnchor && alignAnchor.conversationId !== id) alignAnchor = null;
    detailEntryId = null;
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
        <TodoListPanel entries={session.activePathEntries} />
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
          {#if effectiveDetailEntryId && conversationId}
            <EntryDetailPanel
              {conversationId}
              entryId={effectiveDetailEntryId}
              allEntries={session.allEntries}
              activePathEntries={session.activePathEntries}
              onClose={() => (detailEntryId = null)}
            />
          {:else}
            <ConversationBranchesPanel
              {conversationId}
              allEntries={session.allEntries}
              activePathEntries={session.activePathEntries}
              switchToBranch={session.switchToBranch}
              onAnchorEntrySelected={(entryId) => {
                if (!conversationId) return;
                alignAnchor = {
                  id: resolveVisibleAnchorEntryId(entryId),
                  conversationId,
                  token: ++alignSeq,
                  source: "branch",
                };
              }}
            />
          {/if}
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
      <TodoListPanel entries={session.activePathEntries} />
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
