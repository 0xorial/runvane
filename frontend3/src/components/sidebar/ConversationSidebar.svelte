<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import {
    createConversation,
    getConversations,
    permanentlyDeleteConversation,
    postConversationMessage,
    renameConversation,
    softDeleteConversation,
    undeleteConversation,
  } from "@/api/client";
  import type { ConversationGroupRow, ConversationRow } from "../../../../backend/src/contracts/conversations";
  import {
    mergeSseConversation,
    patchConversationsList,
    refreshConversations,
    upsertConversationInList,
  } from "@/hooks/queries/conversations";
  import { createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { getChatSessionStore, retainChatSessionLive } from "@/lib/chatSessionRegistry";
  import { navigate, replacePath } from "@/lib/router";
  import { subscribeGlobalLive } from "@/protocol/runLiveClient";
  import { SseType } from "@/protocol/sseTypes";
  import { notifyError } from "@/utils/toast";
  import { onMount } from "svelte";
  import ChatToolsPanel from "./ChatToolsPanel.svelte";
  import MultiSelectPanel from "./MultiSelectPanel.svelte";
  import SidebarSectionsList from "./SidebarSectionsList.svelte";
  import TextInputDialog from "./TextInputDialog.svelte";
  import {
    clearConversationSelection,
    conversationSelectionRevision,
    getSelectedConversationIds,
    setSelectedConversationIds,
    toggleConversationSelected,
  } from "@/lib/conversationMultiSelect.svelte";
  import { groupConversations } from "./sidebarSections";

  const PROBE_MESSAGE = "what is the time?";

  let {
    onNewChat,
    onSelect,
    search = "",
  }: {
    onNewChat: () => void;
    onSelect: (id: string) => void;
    search?: string;
  } = $props();

  let showDeletedOnly = $state(false);
  let probeBusy = $state(false);
  let collapsedGroups = $state<Record<string, boolean>>({});
  let renameDialogOpen = $state(false);
  let renameTitleDraft = $state("");
  let renameTarget = $state<ConversationRow | null>(null);

  const conversationsQuery = createQuery(() => ({
    queryKey: queryKeys.conversationList(showDeletedOnly),
    queryFn: () => getConversations({ deletedOnly: showDeletedOnly }),
  }));

  const pricingQuery = createModelCapabilitiesQuery();
  const pricingByModel = $derived(pricingFromCapabilities(pricingQuery.data));
  const conversations = $derived(conversationsQuery.data?.conversations ?? []);
  const groups = $derived(conversationsQuery.data?.groups ?? []);
  const knownGroups = $derived(groups.filter((g: ConversationGroupRow) => String(g.id || "").trim()));
  const sections = $derived(groupConversations(conversations, groups));
  const selectedConversationIds = $derived.by(() => {
    void $conversationSelectionRevision;
    return getSelectedConversationIds();
  });
  const multiSelectMode = $derived(selectedConversationIds.length > 0);

  $effect(() => {
    void showDeletedOnly;
    clearConversationSelection();
  });

  $effect(() => {
    if (conversations.length === 0) return;
    const current = getSelectedConversationIds();
    const valid = current.filter((id) => conversations.some((row: ConversationRow) => row.id === id));
    if (valid.length !== current.length || valid.some((id, index) => id !== current[index])) {
      setSelectedConversationIds(valid);
    }
  });

  function timestampMs(value: string | undefined): number | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  }

  onMount(() => {
    return subscribeGlobalLive({
      onSseEvent: (ev) => {
        if (ev.type === SseType.CONVERSATION_CREATED) {
          if (showDeletedOnly || ev.conversation.isDeleted) return;
          patchConversationsList(showDeletedOnly, (prev) => {
            if (!prev) return prev;
            if (prev.conversations.some((item) => item.id === ev.conversation.id)) return prev;
            return {
              ...prev,
              conversations: [mergeSseConversation(undefined, ev.conversation), ...prev.conversations],
            };
          });
          return;
        }
        if (ev.type === SseType.CONVERSATION_UPDATED) {
          const shouldShow = showDeletedOnly ? ev.conversation.isDeleted : !ev.conversation.isDeleted;
          patchConversationsList(showDeletedOnly, (prev) => {
            if (!prev) return prev;
            const index = prev.conversations.findIndex((item) => item.id === ev.conversation.id);
            if (!shouldShow) {
              if (index === -1) return prev;
              const next = prev.conversations.slice();
              next.splice(index, 1);
              return { ...prev, conversations: next };
            }
            if (index === -1) {
              return {
                ...prev,
                conversations: [mergeSseConversation(undefined, ev.conversation), ...prev.conversations],
              };
            }
            const next = prev.conversations.slice();
            const currentMs = timestampMs(next[index].updatedAt);
            const incomingMs = timestampMs(ev.conversation.updatedAt);
            if (currentMs != null && incomingMs != null && incomingMs < currentMs) return prev;
            next[index] = mergeSseConversation(next[index], ev.conversation);
            return { ...prev, conversations: next };
          });
        }
      },
    });
  });

  async function runProbeTime(): Promise<void> {
    if (probeBusy) return;
    probeBusy = true;
    try {
      const agentId = new URLSearchParams(window.location.search).get("agent")?.trim() || "";
      if (!agentId) {
        notifyError("Select an agent first");
        return;
      }
      const created = await createConversation({ title: "New chat" });
      const id = String(created.id || "").trim();
      if (!id) throw new Error("No conversation id from server");
      retainChatSessionLive();
      getChatSessionStore(id);
      await postConversationMessage(id, { message: PROBE_MESSAGE, agentId });
      replacePath(`/chat/${encodeURIComponent(id)}${window.location.search}`);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      probeBusy = false;
    }
  }

  function onRenameConversation(conversation: ConversationRow): void {
    renameTarget = conversation;
    renameTitleDraft = String(conversation.title || "").trim();
    renameDialogOpen = true;
  }

  async function submitRenameConversation(): Promise<void> {
    const conversation = renameTarget;
    if (!conversation) return;
    const current = String(conversation.title || "").trim();
    const title = renameTitleDraft.trim();
    if (!title || title === current) {
      renameDialogOpen = false;
      renameTarget = null;
      renameTitleDraft = "";
      return;
    }
    try {
      const updated = await renameConversation(conversation.id, { title });
      upsertConversationInList(showDeletedOnly, updated);
      renameDialogOpen = false;
      renameTarget = null;
      renameTitleDraft = "";
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onMoveConversationToGroup(
    conversation: ConversationRow,
    target: { groupId?: string | null; newGroupName?: string },
  ): Promise<void> {
    try {
      await renameConversation(conversation.id, {
        groupId: Object.prototype.hasOwnProperty.call(target, "groupId") ? (target.groupId ?? null) : undefined,
        newGroupName: Object.prototype.hasOwnProperty.call(target, "newGroupName")
          ? String(target.newGroupName ?? "")
          : undefined,
      });
      const data = await refreshConversations(showDeletedOnly);
      const groupId = target.groupId;
      if (typeof groupId === "string" && groupId.trim()) {
        collapsedGroups = { ...collapsedGroups, [groupId]: false };
      } else if (target.newGroupName) {
        const nextGroup = data.groups.find(
          (g) => g.name.localeCompare(target.newGroupName || "", undefined, { sensitivity: "base" }) === 0,
        );
        if (nextGroup?.id) collapsedGroups = { ...collapsedGroups, [nextGroup.id]: false };
      }
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  function deselect(id: string): void {
    if (getSelectedConversationIds().includes(id)) {
      toggleConversationSelected(id, false);
    }
  }

  async function onSoftDeleteConversation(conversation: ConversationRow): Promise<void> {
    try {
      await softDeleteConversation(conversation.id);
      await refreshConversations(showDeletedOnly);
      deselect(conversation.id);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onUndeleteConversation(conversation: ConversationRow): Promise<void> {
    try {
      await undeleteConversation(conversation.id);
      await refreshConversations(showDeletedOnly);
      deselect(conversation.id);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onPermanentlyDeleteConversation(conversation: ConversationRow): Promise<void> {
    if (!window.confirm("Delete this conversation permanently? This action is irreversible.")) return;
    try {
      await permanentlyDeleteConversation(conversation.id);
      await refreshConversations(showDeletedOnly);
      deselect(conversation.id);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeleteSelectedConversations(): Promise<void> {
    if (selectedConversationIds.length === 0) return;
    const confirmed = window.confirm(
      showDeletedOnly
        ? "Delete selected conversations permanently? This action is irreversible."
        : `Delete ${selectedConversationIds.length} selected conversation(s)?`,
    );
    if (!confirmed) return;
    const deletionFn = showDeletedOnly ? permanentlyDeleteConversation : softDeleteConversation;
    const ids = [...selectedConversationIds];
    const results = await Promise.allSettled(ids.map((id) => deletionFn(id)));
    const failedIds: string[] = [];
    let firstReason = "";
    results.forEach((result, index) => {
      if (result.status === "fulfilled") return;
      failedIds.push(ids[index]);
      if (!firstReason) firstReason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    });
    await refreshConversations(showDeletedOnly);
    if (failedIds.length > 0) {
      setSelectedConversationIds(failedIds);
      notifyError(`Deleted ${ids.length - failedIds.length}/${ids.length}. ${firstReason}`);
      return;
    }
    clearConversationSelection();
  }
</script>

<aside class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
  <div class="flex shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2.5 py-2">
    <svg class="h-4 w-4 shrink-0 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </svg>
    <span class="text-sm font-semibold tracking-tight text-foreground">Runvane</span>
  </div>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="shrink-0 space-y-1.5 border-b border-sidebar-border px-2.5 py-2">
      <button
        type="button"
        data-testid="sidebar-new-chat"
        class="flex w-full items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        onclick={onNewChat}
      >
        <svg class="h-3.5 w-3.5 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M5 12h14" /><path d="M12 5v14" />
        </svg>
        New Chat
      </button>
      <button
        type="button"
        data-testid="sidebar-probe-time"
        class="w-full rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        disabled={probeBusy}
        onclick={() => void runProbeTime()}
      >
        Probe: time (tmp)
      </button>
      <button
        type="button"
        class="w-full rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground"
        onclick={() => (showDeletedOnly = !showDeletedOnly)}
      >
        {showDeletedOnly ? "Show active" : "Show deleted"}
      </button>
      {#if multiSelectMode}
        <MultiSelectPanel
          {selectedConversationIds}
          {knownGroups}
          deletedMode={showDeletedOnly}
          reloadConversations={() => refreshConversations(showDeletedOnly)}
          onSelectionChange={setSelectedConversationIds}
          onExpandGroup={(groupId) => (collapsedGroups = { ...collapsedGroups, [groupId]: false })}
          onDeleteSelected={onDeleteSelectedConversations}
        />
      {/if}
    </div>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div class="shrink-0 px-2.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Recent
      </div>
      <div id="conversation-sidebar-list" class="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 py-1.5">
      <SidebarSectionsList
        sections={sections}
        {collapsedGroups}
        {knownGroups}
        {multiSelectMode}
        deletedMode={showDeletedOnly}
        {pricingByModel}
        selectConversation={onSelect}
        renameConversation={onRenameConversation}
        moveConversationToGroup={onMoveConversationToGroup}
        softDeleteConversation={onSoftDeleteConversation}
        undeleteConversation={onUndeleteConversation}
        permanentlyDeleteConversation={onPermanentlyDeleteConversation}
        toggleGroup={(groupId) =>
          (collapsedGroups = { ...collapsedGroups, [groupId]: !(collapsedGroups[groupId] ?? false) })}
      />
      </div>
    </div>
    <ChatToolsPanel {search} />
  </div>
</aside>

<TextInputDialog
  open={renameDialogOpen}
  title="Rename chat"
  value={renameTitleDraft}
  placeholder="Chat title"
  submitLabel="Rename"
  onOpenChange={(open) => {
    renameDialogOpen = open;
    if (!open) {
      renameTarget = null;
      renameTitleDraft = "";
    }
  }}
  onValueChange={(v) => (renameTitleDraft = v)}
  onSubmit={submitRenameConversation}
/>
