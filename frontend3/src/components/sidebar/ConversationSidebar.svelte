<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import {
    createConversation,
    getConversations,
    postConversationMessage,
  } from "@/api/client";
  import { mergeSseConversation, patchConversationsList } from "@/hooks/queries/conversations";
  import { queryKeys } from "@/hooks/queries/keys";
  import { getChatSessionStore, retainChatSessionLive } from "@/lib/chatSessionRegistry";
  import { navigate, replacePath } from "@/lib/router";
  import { subscribeGlobalLive } from "@/protocol/runLiveClient";
  import { SseType } from "@/protocol/sseTypes";
  import { onMount } from "svelte";
  import { groupConversations } from "./sidebarSections";

  const PROBE_MESSAGE = "what is the time?";

  let {
    activeConversationId,
    search,
    onSelect,
  }: {
    activeConversationId: string | null;
    search: string;
    onSelect: (id: string) => void;
  } = $props();

  let probeBusy = $state(false);
  let collapsedGroups = $state<Record<string, boolean>>({});

  const conversationsQuery = createQuery(() => ({
    queryKey: queryKeys.conversationList(false),
    queryFn: () => getConversations({ deletedOnly: false }),
  }));

  const conversations = $derived(conversationsQuery.data?.conversations ?? []);
  const groups = $derived(conversationsQuery.data?.groups ?? []);
  const sections = $derived(groupConversations(conversations, groups));

  onMount(() => {
    return subscribeGlobalLive({
      onSseEvent: (ev) => {
        if (ev.type === SseType.CONVERSATION_CREATED) {
          if (ev.conversation.isDeleted) return;
          patchConversationsList(false, (prev) => {
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
          patchConversationsList(false, (prev) => {
            if (!prev) return prev;
            const index = prev.conversations.findIndex((item) => item.id === ev.conversation.id);
            if (ev.conversation.isDeleted) {
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
            next[index] = mergeSseConversation(next[index], ev.conversation);
            return { ...prev, conversations: next };
          });
        }
      },
    });
  });

  function newChat(): void {
    navigate(`/chat/new${search}`);
  }

  function toggleGroup(groupId: string): void {
    collapsedGroups = { ...collapsedGroups, [groupId]: !(collapsedGroups[groupId] ?? false) };
  }

  async function runProbeTime(): Promise<void> {
    if (probeBusy) return;
    probeBusy = true;
    try {
      const agentId = new URLSearchParams(search).get("agent")?.trim() || "";
      if (!agentId) throw new Error("Select an agent first (?agent= in URL)");

      const created = await createConversation({ title: "New chat" });
      const id = String(created.id || "").trim();
      if (!id) throw new Error("No conversation id from server");

      retainChatSessionLive();
      getChatSessionStore(id);

      await postConversationMessage(id, { message: PROBE_MESSAGE, agentId });

      replacePath(`/chat/${encodeURIComponent(id)}${search}`);
    } finally {
      probeBusy = false;
    }
  }

</script>

<aside class="flex h-full min-h-0 w-full flex-col border-r border-border bg-sidebar">
  <div class="shrink-0 space-y-1.5 border-b border-border px-2.5 py-2">
    <button
      type="button"
      data-testid="sidebar-new-chat"
      class="w-full rounded-md bg-primary/10 px-2.5 py-1.5 text-left text-xs font-medium text-primary"
      onclick={newChat}
    >
      New Chat
    </button>
    <button
      type="button"
      data-testid="sidebar-probe-time"
      class="w-full rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground disabled:opacity-50"
      disabled={probeBusy}
      onclick={() => void runProbeTime()}
    >
      Probe: time (tmp)
    </button>
  </div>

  <div
    id="conversation-sidebar-list"
    class="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 py-1.5"
  >
    {#each sections as section (section.kind === "conversation" ? section.row.id : section.groupId)}
      {#if section.kind === "conversation"}
        <div
          data-conversation-row
          data-conversation-id={section.row.id}
          data-active={activeConversationId === section.row.id ? "true" : "false"}
          class="rounded-md data-[active=true]:bg-secondary"
        >
          <button
            type="button"
            data-testid={`sidebar-conversation-${section.row.id}`}
            class="w-full truncate px-2 py-1.5 text-left text-xs text-foreground"
            onclick={() => onSelect(section.row.id)}
          >
            {section.row.title || "Untitled"}
          </button>
        </div>
      {:else}
        {@const collapsed = collapsedGroups[section.groupId] ?? false}
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-secondary/40"
          onclick={() => toggleGroup(section.groupId)}
        >
          <span class="truncate">{section.groupName}</span>
          <span class="ml-2 shrink-0">{collapsed ? "▸" : "▾"} {section.rows.length}</span>
        </button>
        {#if !collapsed}
          {#each section.rows as row (row.id)}
            <div
              data-conversation-row
              data-conversation-id={row.id}
              data-active={activeConversationId === row.id ? "true" : "false"}
              class="ml-3 rounded-md data-[active=true]:bg-secondary"
            >
              <button
                type="button"
                data-testid={`sidebar-conversation-${row.id}`}
                class="w-full truncate px-2 py-1.5 text-left text-xs text-foreground"
                onclick={() => onSelect(row.id)}
              >
                {row.title || "Untitled"}
              </button>
            </div>
          {/each}
        {/if}
      {/if}
    {/each}
  </div>
</aside>
