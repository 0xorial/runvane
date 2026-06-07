import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { setConversationDefaultViewLeaf } from "../api/client";
import {
  getChatSessionPending,
  getChatSessionStore,
  getEmptyChatSessionStore,
  retainChatSessionLive,
} from "@/lib/chatSessionRegistry";
import { loadConversationSession } from "./queries/conversations";
import { mapApiMessagesToChatEntries } from "../utils/chatEntries";
import type { ChatAttachment, UserMessageEntry } from "../protocol/chatEntry";
import type { LlmRef } from "../../../backend/src/contracts/llm";
import type { ObservableItem } from "../utils/observableCollection";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
import type { ChatSessionStore, PendingMessage } from "@/lib/chatSessionStore";

/** Stable empty reference so useSyncExternalStore doesn't loop when there's no store. */
const EMPTY_PENDING: PendingMessage[] = [];

export type OptimisticUserMessage = {
  rowId: string;
  clientRequestId: string;
  parentId: string | null;
};

type AppendOptimisticUserMessageInput = {
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

export function useChatSession(conversationId: string | null | undefined) {
  const boundCid = conversationId ? String(conversationId) : null;
  const storeRef = useRef<ChatSessionStore | null>(null);
  if (boundCid) {
    storeRef.current = getChatSessionStore(boundCid);
  } else {
    storeRef.current = null;
  }
  const store = storeRef.current;

  const [isSessionLoading, setIsSessionLoading] = useState(false);

  const subscribeRows = useCallback(
    (listener: () => void) => store?.subscribeRows(listener) ?? (() => {}),
    [store],
  );
  const getRowsVersion = useCallback(() => store?.getRowsVersion() ?? 0, [store]);
  const rowsVersion = useSyncExternalStore(subscribeRows, getRowsVersion, getRowsVersion);

  const subscribeActivePath = useCallback(
    (listener: () => void) => store?.subscribeActivePath(listener) ?? (() => {}),
    [store],
  );
  const getActivePathVersion = useCallback(() => store?.getActivePathVersion() ?? 0, [store]);
  const activePathVersion = useSyncExternalStore(subscribeActivePath, getActivePathVersion, getActivePathVersion);

  const subscribePending = useCallback(
    (listener: () => void) => store?.subscribePending(listener) ?? (() => {}),
    [store],
  );
  const getPending = useCallback(() => store?.getPendingMessages() ?? EMPTY_PENDING, [store]);
  const pendingMessages = useSyncExternalStore(subscribePending, getPending, getPending);

  const activePathEntries = useMemo((): ObservableItem<LinkedChatEntry>[] => {
    void rowsVersion;
    void activePathVersion;
    return store?.getActivePathRows() ?? [];
  }, [store, rowsVersion, activePathVersion]);

  const allEntries = useMemo(() => {
    void rowsVersion;
    return store?.getAllRows() ?? [];
  }, [store, rowsVersion]);

  useEffect(() => {
    if (!boundCid || !store) {
      setIsSessionLoading(false);
      return;
    }

    const cid = boundCid;
    const releaseLive = retainChatSessionLive();
    const warmCache = store.getAllRows().length > 0;
    setIsSessionLoading(!warmCache);

    let cancelled = false;
    void (async () => {
      try {
        const session = await loadConversationSession(cid);
        if (cancelled) return;
        const entries = mapApiMessagesToChatEntries(session.entries);
        if (store.getAllRows().length === 0) {
          store.replace(entries, session.leafId, session.anchorId);
        } else {
          for (const entry of entries) {
            if (!store.getById(entry.id)) store.appendEntry(entry);
          }
          if (!store.hasViewAnchor()) store.setViewAnchor(session.anchorId);
        }
      } catch (err) {
        console.error("[useChatSession] Failed to load conversation messages:", err);
      } finally {
        if (!cancelled) setIsSessionLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      releaseLive();
    };
  }, [boundCid, store]);

  const setActiveLeaf = useCallback(
    async (entryId: string) => {
      if (!boundCid || !store) return;
      if (!store.getById(entryId)) {
        const session = await loadConversationSession(boundCid);
        store.replace(mapApiMessagesToChatEntries(session.entries), session.leafId, session.anchorId);
      }
      store.setChosenPathFromLeaf(entryId);
      const tipId = store.activePathTipId() ?? entryId;
      await setConversationDefaultViewLeaf(boundCid, tipId);
      store.setViewAnchor(tipId);
    },
    [boundCid, store],
  );

  const switchToBranch = useCallback(
    async (branchEntryId: string) => {
      if (!boundCid || !store) return;
      const tipId = store.chooseBranchLine(branchEntryId);
      await setConversationDefaultViewLeaf(boundCid, tipId);
      store.setViewAnchor(tipId);
    },
    [boundCid, store],
  );

  const appendOptimisticUserMessage = useCallback(
    (input: AppendOptimisticUserMessageInput): OptimisticUserMessage | null => {
      const cid = String(input.conversationId || "").trim();
      if (!boundCid || cid !== boundCid || !store) return null;
      const text = String(input.text || "").trim();
      if (!text) return null;
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
    [boundCid, store],
  );

  return {
    sessionStore: store ?? getEmptyChatSessionStore(),
    activePathEntries,
    allEntries,
    pendingMessages,
    isSessionLoading,
    setActiveLeaf,
    switchToBranch,
    appendOptimisticUserMessage,
  };
}
