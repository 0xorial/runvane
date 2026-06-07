import { setConversationDefaultViewLeaf } from "@/api/client";
import {
  getChatSessionPending,
  getChatSessionStore,
  getEmptyChatSessionStore,
  retainChatSessionLive,
} from "@/lib/chatSessionRegistry";
import type { UserMessageEntry } from "@/protocol/chatEntry";
import type { LlmRef } from "../../../backend/src/contracts/llm";
import type { ChatAttachment } from "@/protocol/chatEntry";
import type { ChatSessionStore, PendingMessage } from "@/lib/chatSessionStore";
import { fetchConversationSession, type ConversationSession } from "@/hooks/queries/conversations";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/hooks/queries/keys";
import { mapApiMessagesToChatEntries } from "@/utils/chatEntries";
import type { ObservableItem } from "@/utils/observableCollection";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";

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
      return;
    }

    const nextStore = getChatSessionStore(boundCid);
    store = nextStore;
    releaseLive = retainChatSessionLive();
    rowUnsub = nextStore.subscribeRows(bumpRows);
    pathUnsub = nextStore.subscribeActivePath(bumpPath);
    pendingUnsub = nextStore.subscribePending(bumpRows);

    const warmStore = nextStore.getAllRows().length > 0;
    const cachedSession = queryClient.getQueryData<ConversationSession>(
      queryKeys.conversationSession(boundCid),
    );

    if (warmStore && cachedSession) {
      isSessionLoading = false;
      return teardown;
    }

    isSessionLoading = !warmStore;
    let cancelled = false;

    void (async () => {
      try {
        const session = await fetchConversationSession(boundCid);
        if (cancelled) return;
        const entries = mapApiMessagesToChatEntries(session.entries);
        if (nextStore.getAllRows().length === 0) {
          nextStore.replace(entries, session.leafId, session.anchorId);
        } else {
          for (const entry of entries) {
            if (!nextStore.getById(entry.id)) nextStore.appendEntry(entry);
          }
          if (!nextStore.hasViewAnchor()) nextStore.setViewAnchor(session.anchorId);
        }
      } catch (err) {
        console.error("[chatSession] Failed to load conversation messages:", err);
      } finally {
        if (!cancelled) isSessionLoading = false;
      }
    })();

    return () => {
      cancelled = true;
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
      return store?.getActivePathRows() ?? [];
    },
    get pendingMessages(): PendingMessage[] {
      void rowsTick;
      return store?.getPendingMessages() ?? [];
    },
    get allEntries(): ObservableItem<LinkedChatEntry>[] {
      void rowsTick;
      return store?.getAllRows() ?? [];
    },
    async setActiveLeaf(entryId: string): Promise<void> {
      const boundCid = getConversationId();
      if (!boundCid || !store) return;
      if (!store.getById(entryId)) {
        const session = await fetchConversationSession(boundCid);
        store.replace(mapApiMessagesToChatEntries(session.entries), session.leafId, session.anchorId);
      }
      store.setChosenPathFromLeaf(entryId);
      const tipId = store.activePathTipId() ?? entryId;
      await setConversationDefaultViewLeaf(boundCid, tipId);
      store.setViewAnchor(tipId);
    },
    async switchToBranch(branchEntryId: string): Promise<void> {
      const boundCid = getConversationId();
      if (!boundCid || !store) return;
      const tipId = store.chooseBranchLine(branchEntryId);
      await setConversationDefaultViewLeaf(boundCid, tipId);
      store.setViewAnchor(tipId);
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
