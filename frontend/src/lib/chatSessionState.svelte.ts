import { getConversation, setConversationDefaultViewLeaf } from "@/api/client";
import { get } from "svelte/store";
import {
  getChatSessionPending,
  getChatSessionStore,
  getEmptyChatSessionStore,
  retainChatSessionLive,
  subscribeConversationStream,
} from "@/lib/chatSessionRegistry";
import { resetChatToolDraft, seedChatToolDraftFromUserMessage } from "@/lib/chatToolDraft.svelte";
import { pathname, replacePath } from "@/lib/router";
import type { UserMessageEntry } from "@/protocol/chatEntry";
import type { LlmRef } from "../../../backend/src/contracts/llm";
import type { ChatAttachment } from "@/protocol/chatEntry";
import type { ChatSessionStore, PendingMessage } from "@/lib/chatSessionStore";
import { loadConversationSession } from "@/hooks/queries/conversations";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/hooks/queries/keys";
import { mapApiMessagesToChatEntries } from "@/utils/chatEntries";
import type { ObservableItem } from "@/utils/observableCollection";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";

const EMPTY_PATH_ROWS: ObservableItem<LinkedChatEntry>[] = [];
const EMPTY_ALL_ROWS: ObservableItem<LinkedChatEntry>[] = [];
const EMPTY_PENDING: PendingMessage[] = [];

export type OptimisticUserMessage = {
  rowId: string;
  clientRequestId: string;
  parentId: string | null;
};

export type AppendOptimisticUserMessageInput = {
  conversationId: string;
  text: string;
  agentId: string;
  llm?: LlmRef;
  modelPresetId?: number | null;
  attachments?: ChatAttachment[];
};

// Keep the `?agent=` URL param (which drives the chat tools panel and the
// composer's agent selector) in sync with the agent this conversation/branch
// was actually last used with — otherwise switching conversations leaves
// those panels showing whatever agent happened to be selected before.
function syncAgentIdFromLastUser(entry: UserMessageEntry | null): void {
  const agentId = entry?.agentId?.trim();
  if (!agentId) return;
  const path = get(pathname);
  const q = path.indexOf("?");
  const pathOnly = q >= 0 ? path.slice(0, q) : path;
  const params = new URLSearchParams(q >= 0 ? path.slice(q) : "");
  if (params.get("agent") === agentId) return;
  params.set("agent", agentId);
  replacePath(`${pathOnly}?${params.toString()}`);
}

function seedToolDraftFromStore(activeStore: ChatSessionStore): void {
  const path = activeStore.getActivePathRows().map((row$) => row$.get());
  const lastUser = [...path].reverse().find((entry) => entry.type === "user-message");
  const lastUserEntry = lastUser?.type === "user-message" ? lastUser : null;
  seedChatToolDraftFromUserMessage(lastUserEntry);
  syncAgentIdFromLastUser(lastUserEntry);
}

function buildOptimisticUserEntry(
  input: AppendOptimisticUserMessageInput,
  rowId: string,
  parentId: string | null,
): UserMessageEntry {
  return {
    type: "user-message",
    id: rowId,
    conversationIndex: -1,
    createdAt: new Date().toISOString(),
    parentId,
    text: input.text,
    agentId: input.agentId,
    ...(input.llm ? { llm: input.llm } : {}),
    ...(input.modelPresetId != null ? { modelPresetId: input.modelPresetId } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  };
}

export function createChatSessionState(getConversationId: () => string | null) {
  let isSessionLoading = $state(false);
  let rowsTick = $state(0);
  let pathTick = $state(0);
  let store: ChatSessionStore | null = $state(null);

  function bumpRows(): void {
    rowsTick += 1;
  }

  function bumpPath(): void {
    pathTick += 1;
  }

  let releaseLive: (() => void) | null = null;
  let rowUnsub: (() => void) | null = null;
  let pathUnsub: (() => void) | null = null;
  let pendingUnsub: (() => void) | null = null;

  function teardown(): void {
    rowUnsub?.();
    pathUnsub?.();
    pendingUnsub?.();
    rowUnsub = null;
    pathUnsub = null;
    pendingUnsub = null;
    releaseLive?.();
    releaseLive = null;
  }

  $effect(() => {
    const boundCid = getConversationId();
    teardown();

    if (!boundCid) {
      store = null;
      isSessionLoading = false;
      resetChatToolDraft();
      return;
    }

    const nextStore = getChatSessionStore(boundCid);
    store = nextStore;
    releaseLive = retainChatSessionLive();

    let cancelled = false;
    // The tool-override draft and the `?agent=` param (which drive the chat
    // tools panel + composer agent selector) are both seeded from the
    // conversation's last user message — which only exists once the entries
    // snapshot has populated the active path. That snapshot arrives over SSE,
    // a source independent of the getConversation() metadata fetch below, so a
    // seed run straight after the metadata resolves races the snapshot: if
    // metadata wins, the path is still empty, the seed no-ops, and the panels
    // stay stuck on the previously-viewed conversation's agent/overrides.
    // Seed exactly once, when the path is first non-empty, driven by whichever
    // source gets there. The one-shot guard also stops a later reconnect
    // re-snapshot from clobbering a manual agent pick.
    let seededFromEntries = false;
    const seedWhenEntriesReady = (): void => {
      if (seededFromEntries || cancelled) return;
      if (nextStore.getActivePathRows().length === 0) return;
      seededFromEntries = true;
      seedToolDraftFromStore(nextStore);
    };

    rowUnsub = nextStore.subscribeRows(bumpRows);
    pathUnsub = nextStore.subscribeActivePath(() => {
      bumpPath();
      seedWhenEntriesReady();
    });
    pendingUnsub = nextStore.subscribePending(bumpRows);

    isSessionLoading = nextStore.getAllRows().length === 0;
    // Clear the previous conversation's draft up front so its custom rules don't
    // linger while this one's entries load; seedWhenEntriesReady restores this
    // conversation's overrides + agent once they arrive.
    resetChatToolDraft();
    // Cached store (revisiting a conversation): entries are already present, so
    // seed synchronously — the snapshot subscription won't re-fire for it.
    seedWhenEntriesReady();

    // Per-conversation live stream: its first frame is the entries snapshot
    // (seeds the store + baselines the watermark), then live mutations. The
    // EventSource auto-reconnects and the server resends a snapshot first, so
    // reconnect == re-snapshot — no replay buffer, no client seq negotiation.
    const closeStream = subscribeConversationStream(boundCid);

    void (async () => {
      try {
        // Conversation metadata (title, view anchor) — the stream carries the
        // entries, not the conversation row.
        const conversation = await getConversation(boundCid);
        if (cancelled) return;
        queryClient.setQueryData(queryKeys.conversation(boundCid), conversation);
        if (!nextStore.hasViewAnchor() && conversation.defaultViewLeafAnchorId) {
          nextStore.setViewAnchor(conversation.defaultViewLeafAnchorId);
        }
        // The anchor may have just resolved the path against already-loaded rows.
        seedWhenEntriesReady();
      } catch (err) {
        console.error("[chatSession] Failed to load conversation metadata:", err);
      } finally {
        if (!cancelled) isSessionLoading = false;
      }
    })();

    return () => {
      cancelled = true;
      isSessionLoading = false;
      closeStream();
      teardown();
    };
  });

  return {
    get store() {
      return store ?? getEmptyChatSessionStore();
    },
    get isSessionLoading() {
      return isSessionLoading;
    },
    get activePathEntries(): ObservableItem<LinkedChatEntry>[] {
      void rowsTick;
      void pathTick;
      return store?.getActivePathRows() ?? EMPTY_PATH_ROWS;
    },
    get pendingMessages(): PendingMessage[] {
      void rowsTick;
      return store?.getPendingMessages() ?? EMPTY_PENDING;
    },
    get allEntries(): ObservableItem<LinkedChatEntry>[] {
      void rowsTick;
      return store?.getAllRows() ?? EMPTY_ALL_ROWS;
    },
    async setActiveLeaf(entryId: string): Promise<void> {
      const boundCid = getConversationId();
      if (!boundCid || !store) return;
      if (!store.getById(entryId)) {
        const session = await loadConversationSession(boundCid);
        store.replace(mapApiMessagesToChatEntries(session.entries), session.leafId, session.anchorId);
      }
      store.setChosenPathFromLeaf(entryId);
      const tipId = store.activePathTipId() ?? entryId;
      await setConversationDefaultViewLeaf(boundCid, tipId);
      store.setViewAnchor(tipId);
      seedToolDraftFromStore(store);
    },
    async switchToBranch(branchEntryId: string): Promise<void> {
      const boundCid = getConversationId();
      if (!boundCid || !store) return;
      const tipId = store.chooseBranchLine(branchEntryId);
      await setConversationDefaultViewLeaf(boundCid, tipId);
      store.setViewAnchor(tipId);
      seedToolDraftFromStore(store);
    },
    appendOptimisticUserMessage(input: AppendOptimisticUserMessageInput): OptimisticUserMessage | null {
      const boundCid = getConversationId();
      const cid = String(input.conversationId || "").trim();
      if (!boundCid || cid !== boundCid || !store) return null;
      const text = String(input.text || "").trim();
      const hasAttachments = (input.attachments?.length ?? 0) > 0;
      if (!text && !hasAttachments) return null;
      const agentId = String(input.agentId || "").trim();
      if (!agentId) throw new Error("appendOptimisticUserMessage requires agentId");

      const path = store.getActivePathRows().map((row$) => row$.get());
      const parentId = path.length > 0 ? path[path.length - 1].id : null;
      const clientRequestId = crypto.randomUUID();
      const rowId = `optimistic-user-${clientRequestId}`;
      const pending = getChatSessionPending(boundCid);
      pending.set(clientRequestId, rowId);
      const row = buildOptimisticUserEntry({ ...input, text, agentId }, rowId, parentId);
      store.appendEntry(row);
      return { rowId, clientRequestId, parentId };
    },
  };
}
