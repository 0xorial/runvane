<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import {
    createConversation,
    getConversations,
    permanentlyDeleteConversation,
    postConversationMessage,
    renameConversation,
    setConversationGroupPinned,
    softDeleteConversation,
    undeleteConversation,
  } from "@/api/client";
  import type {
    ConversationGroupRow,
    ConversationRow,
    GetConversationsResponse,
  } from "../../../../backend/src/contracts/conversations";
  import { queryClient } from "@/lib/queryClient";
  import {
    mergeSseConversation,
    patchConversationsList,
    refreshConversations,
    upsertConversationInList,
  } from "@/hooks/queries/conversations";
  import { createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import { queryKeys } from "@/hooks/queries/keys";
  import { getChatSessionStore, retainChatSessionLive } from "@/lib/chatSessionRegistry";
  import { replacePath } from "@/lib/router";
  import { subscribeGlobalLive } from "@/protocol/runLiveClient";
  import { SseType } from "@/protocol/sseTypes";
  import { notifyError } from "@/utils/toast";
  import { onMount } from "svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import Spinner from "@/components/ui/Spinner.svelte";
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
    onSelect,
    onNewChat,
    onShowAll,
    showProbe = false,
    recentLimit,
    enableTextSearch = false,
    enableMultiSelect = false,
    enableDeletedView = false,
    dense = true,
  }: {
    onSelect: (id: string) => void;
    /** When provided, render a New Chat button. */
    onNewChat?: () => void;
    /** When provided, render an "All conversations" link beside the count row. */
    onShowAll?: () => void;
    /** Sidebar-only temporary probe button. */
    showProbe?: boolean;
    /** Cap the list to the N most-recent conversations (sidebar). Omit = all. */
    recentLimit?: number;
    /** Render a title filter box (full page). */
    enableTextSearch?: boolean;
    /** Enable per-row selection checkboxes and the multi-select panel (full page only). */
    enableMultiSelect?: boolean;
    /** Render the active/deleted toggle (full page only — the sidebar shows active only). */
    enableDeletedView?: boolean;
    /** Compact paddings for the narrow sidebar. */
    dense?: boolean;
  } = $props();

  let showDeletedOnly = $state(false);
  let probeBusy = $state(false);
  let filterText = $state("");
  let collapsedGroups = $state<Record<string, boolean>>({});
  let renameDialogOpen = $state(false);
  let renameTitleDraft = $state("");
  let renameTarget = $state<ConversationRow | null>(null);

  const conversationsQuery = createQuery(() => ({
    queryKey: queryKeys.conversationList(showDeletedOnly, recentLimit),
    queryFn: () => getConversations({ deletedOnly: showDeletedOnly, limit: recentLimit }),
  }));

  const pricingQuery = createModelCapabilitiesQuery();
  const pricingByModel = $derived(pricingFromCapabilities(pricingQuery.data));
  const conversations = $derived(conversationsQuery.data?.conversations ?? []);
  const groups = $derived(conversationsQuery.data?.groups ?? []);
  // Server-reported count of all conversations in scope (ignores the fetch
  // limit); falls back to what we have when the field is absent.
  const total = $derived(conversationsQuery.data?.total ?? conversations.length);
  // Per-group totals ignore the recent-N window, so a group's counter reflects
  // its full size rather than only the rows that fit in the window. Absent on
  // the unwindowed full-page list, where loaded rows already cover each group.
  const groupTotals = $derived(conversationsQuery.data?.groupTotals);
  const knownGroups = $derived(groups.filter((g: ConversationGroupRow) => String(g.id || "").trim()));

  const normalizedFilter = $derived(filterText.trim().toLowerCase());
  const filteredConversations = $derived.by(() => {
    let working = conversations;
    if (enableTextSearch && normalizedFilter) {
      working = working.filter((row: ConversationRow) =>
        String(row.title || "").toLowerCase().includes(normalizedFilter),
      );
    }
    // The backend returns conversations newest-first, so slicing yields the
    // most-recent N. Limit after filtering so search still spans everything.
    if (typeof recentLimit === "number" && recentLimit > 0) {
      working = working.slice(0, recentLimit);
    }
    return working;
  });
  const hiddenByLimit = $derived(
    typeof recentLimit === "number" && recentLimit > 0
      ? Math.max(0, total - filteredConversations.length)
      : 0,
  );
  const sections = $derived(groupConversations(filteredConversations, groups, groupTotals));
  const selectedConversationIds = $derived.by(() => {
    void $conversationSelectionRevision;
    return enableMultiSelect ? getSelectedConversationIds() : [];
  });
  const selectedConversationIdSet = $derived(new Set(selectedConversationIds));
  const multiSelectMode = $derived(enableMultiSelect && selectedConversationIds.length > 0);

  $effect(() => {
    void showDeletedOnly;
    if (!enableMultiSelect) return;
    clearConversationSelection();
  });

  $effect(() => {
    if (!enableMultiSelect || conversations.length === 0) return;
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
          const groupId = String(ev.conversation.groupId || "").trim();
          if (groupId) {
            const cached = queryClient.getQueryData<GetConversationsResponse>(
              queryKeys.conversationList(showDeletedOnly, recentLimit),
            );
            if (cached && !cached.groups.some((group) => group.id === groupId)) {
              void refreshConversations(showDeletedOnly, recentLimit);
            }
          }
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
      const data = await refreshConversations(showDeletedOnly, recentLimit);
      // Invalidate the whole conversation-list family: the active query is keyed
      // with `limit: recentLimit`, so a `limit: null` key would not match it and
      // a freshly created group would never re-render.
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
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

  async function onSetGroupPinned(conversation: ConversationRow, pinned: boolean): Promise<void> {
    try {
      const updated = await setConversationGroupPinned(conversation.id, pinned);
      upsertConversationInList(showDeletedOnly, updated);
      // Unpinning re-runs categorization server-side; pick up the new group.
      if (!pinned) await refreshConversations(showDeletedOnly, recentLimit);
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
      await refreshConversations(showDeletedOnly, recentLimit);
      deselect(conversation.id);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onUndeleteConversation(conversation: ConversationRow): Promise<void> {
    try {
      await undeleteConversation(conversation.id);
      await refreshConversations(showDeletedOnly, recentLimit);
      deselect(conversation.id);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onPermanentlyDeleteConversation(conversation: ConversationRow): Promise<void> {
    if (!window.confirm("Delete this conversation permanently? This action is irreversible.")) return;
    try {
      await permanentlyDeleteConversation(conversation.id);
      await refreshConversations(showDeletedOnly, recentLimit);
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
    await refreshConversations(showDeletedOnly, recentLimit);
    if (failedIds.length > 0) {
      setSelectedConversationIds(failedIds);
      notifyError(`Deleted ${ids.length - failedIds.length}/${ids.length}. ${firstReason}`);
      return;
    }
    clearConversationSelection();
  }

  const controlPad = $derived(dense ? "px-2.5 py-2" : "px-3 py-3");
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
  <div class="shrink-0 space-y-1.5 border-b border-sidebar-border {controlPad}">
    {#if onNewChat}
      <button
        type="button"
        data-testid="sidebar-new-chat"
        class="flex w-full items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        onclick={onNewChat}
      >
        <Icon name="message-square" class="h-3.5 w-3.5 shrink-0" />
        New Chat
      </button>
    {/if}
    {#if enableTextSearch}
      <label class="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs">
        <Icon name="search" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="search"
          data-testid="conversations-search"
          placeholder="Search conversations…"
          class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          bind:value={filterText}
        />
      </label>
    {/if}
    {#if showProbe}
      <button
        type="button"
        data-testid="sidebar-probe-time"
        class="w-full rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        disabled={probeBusy}
        onclick={() => void runProbeTime()}
      >
        Probe: time (tmp)
      </button>
    {/if}
    {#if enableDeletedView}
      <button
        type="button"
        data-testid="conversations-toggle-deleted"
        class="w-full rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground"
        onclick={() => (showDeletedOnly = !showDeletedOnly)}
      >
        {showDeletedOnly ? "Show active" : "Show deleted"}
      </button>
    {/if}
    {#if multiSelectMode}
      <MultiSelectPanel
        {selectedConversationIds}
        {knownGroups}
        deletedMode={showDeletedOnly}
        reloadConversations={() => refreshConversations(showDeletedOnly, recentLimit)}
        onSelectionChange={setSelectedConversationIds}
        onExpandGroup={(groupId) => (collapsedGroups = { ...collapsedGroups, [groupId]: false })}
        onDeleteSelected={onDeleteSelectedConversations}
      />
    {/if}
  </div>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {#if onShowAll || (hiddenByLimit > 0 && !normalizedFilter)}
      <div class="flex shrink-0 items-center gap-2 px-2.5 pt-1.5">
        {#if hiddenByLimit > 0 && !normalizedFilter}
          <span class="text-[10px] text-muted-foreground">
            Showing latest {recentLimit} of {total}
          </span>
        {/if}
        {#if onShowAll}
          <button
            type="button"
            data-testid="sidebar-all-conversations"
            class="ml-auto flex items-center gap-1 rounded text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            onclick={onShowAll}
          >
            <Icon name="list" class="h-3 w-3 shrink-0" />
            All conversations
          </button>
        {/if}
      </div>
    {/if}
    <div
      class="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 py-1.5"
      data-testid="conversations-list"
    >
      {#if conversationsQuery.isPending}
        <div
          class="flex items-center justify-center gap-2 px-2 py-6 text-xs text-muted-foreground"
          data-testid="conversations-loading"
        >
          <Spinner size={14} />
          <span>Loading conversations…</span>
        </div>
      {:else if sections.length === 0}
        <div class="px-2 py-6 text-center text-xs text-muted-foreground">
          {normalizedFilter ? "No conversations match your search." : "No conversations yet."}
        </div>
      {:else}
        <SidebarSectionsList
          {sections}
          {collapsedGroups}
          {knownGroups}
          {enableMultiSelect}
          {multiSelectMode}
          {selectedConversationIdSet}
          deletedMode={showDeletedOnly}
          {pricingByModel}
          selectConversation={onSelect}
          renameConversation={onRenameConversation}
          moveConversationToGroup={onMoveConversationToGroup}
          setGroupPinned={onSetGroupPinned}
          softDeleteConversation={onSoftDeleteConversation}
          undeleteConversation={onUndeleteConversation}
          permanentlyDeleteConversation={onPermanentlyDeleteConversation}
          toggleGroup={(groupId) =>
            (collapsedGroups = { ...collapsedGroups, [groupId]: !(collapsedGroups[groupId] ?? false) })}
        />
      {/if}
    </div>
  </div>
</div>

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
