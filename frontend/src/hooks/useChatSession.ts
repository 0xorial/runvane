import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { setConversationDefaultViewLeaf } from "../api/client";
import { branchLineTipId, buildActivePath, viewAnchorAfterAppend } from "@/lib/chatTree";
import { loadConversationSession } from "./queries/conversations";
import { subscribeGlobalLive } from "../protocol/runLiveClient";
import { defaultChatEntries, mapApiMessagesToChatEntries } from "../utils/chatEntries";
import { assertNever } from "../utils/assertNever";
import { SseType, type SseEvent } from "../protocol/sseTypes";
import type { ChatAttachment, ChatEntry, UserMessageEntry } from "../protocol/chatEntry";
import type { LlmRef } from "../../../backend/src/contracts/llm";
import { createObservableItemCollection, type ObservableItem } from "../utils/observableCollection";

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

function applySseToStore(
  store: ReturnType<typeof createObservableItemCollection<ChatEntry>>,
  pending: Map<string, string>,
  ev: SseEvent,
  onNewEntry: (entry: ChatEntry, replacedOptimisticId?: string) => void,
): void {
  switch (ev.type) {
    case SseType.CONVERSATION_CREATED:
    case SseType.CONVERSATION_UPDATED:
    case SseType.TOOL_INVOCATION_START:
    case SseType.TOOL_INVOCATION_END:
      return;
    case SseType.USER_MESSAGE: {
      const optimisticId = ev.clientRequestId ? pending.get(ev.clientRequestId) : undefined;
      if (optimisticId && ev.clientRequestId) {
        pending.delete(ev.clientRequestId);
        if (!store.replaceById(optimisticId, ev.entry)) store.append(ev.entry);
        onNewEntry(ev.entry, optimisticId);
        return;
      }
      if (store.append(ev.entry)) onNewEntry(ev.entry);
      return;
    }
    case SseType.CHAT_ENTRY_UPSERT:
      if (store.getById(ev.entry.id)) store.replaceById(ev.entry.id, ev.entry);
      else if (store.append(ev.entry)) onNewEntry(ev.entry);
      return;
    case SseType.CHAT_ENTRY_DELTA: {
      const row$ = store.getById(ev.chatEntryId);
      if (!row$) return;
      row$.mutate((current) => {
        const row = current as Record<string, unknown>;
        const prev = typeof row[ev.field] === "string" ? (row[ev.field] as string) : "";
        row[ev.field] = `${prev}${ev.delta}`;
      });
      return;
    }
    default:
      assertNever(ev);
  }
}

export function useChatSession(conversationId: string | null | undefined) {
  const boundCid = conversationId ? String(conversationId) : null;
  const storeRef = useRef(createObservableItemCollection<ChatEntry>(defaultChatEntries));
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const activeLeafIdRef = useRef<string | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const pendingByClientRequestIdRef = useRef<Map<string, string>>(new Map());

  const applyActiveLeaf = useCallback((leafId: string) => {
    activeLeafIdRef.current = leafId;
    setActiveLeafId(leafId);
  }, []);

  const followNewEntry = useCallback(
    (entry: ChatEntry, replacedOptimisticId?: string) => {
      if (replacedOptimisticId && activeLeafIdRef.current === replacedOptimisticId) {
        applyActiveLeaf(entry.id);
        return;
      }
      const entries = storeRef.current.getRows().map((row$) => row$.get());
      const next = viewAnchorAfterAppend(entries, activeLeafIdRef.current, entry);
      if (next === activeLeafIdRef.current) return;
      if (next) applyActiveLeaf(next);
    },
    [applyActiveLeaf],
  );

  const subscribeRows = useCallback((listener: () => void) => storeRef.current.subscribeRows(listener), []);
  const getRowsVersion = useCallback(() => storeRef.current.getRowsVersion(), []);
  const rowsVersion = useSyncExternalStore(subscribeRows, getRowsVersion, getRowsVersion);

  const activePathEntries = useMemo((): ObservableItem<ChatEntry>[] => {
    void rowsVersion;
    const path = buildActivePath(
      storeRef.current.getRows().map((row$) => row$.get()),
      activeLeafId,
    );
    return path
      .map((entry) => storeRef.current.getById(entry.id))
      .filter((row$): row$ is ObservableItem<ChatEntry> => row$ != null);
  }, [activeLeafId, rowsVersion]);

  const allEntries = useMemo(() => {
    void rowsVersion;
    return storeRef.current.getRows().slice();
  }, [rowsVersion]);

  useEffect(() => {
    if (!boundCid) {
      storeRef.current.replace(defaultChatEntries);
      activeLeafIdRef.current = null;
      setActiveLeafId(null);
      pendingByClientRequestIdRef.current.clear();
      setIsSessionLoading(false);
      return;
    }

    const cid = boundCid;
    const store = storeRef.current;
    const pending = pendingByClientRequestIdRef.current;
    store.replace(defaultChatEntries);
    activeLeafIdRef.current = null;
    setActiveLeafId(null);
    pending.clear();
    setIsSessionLoading(true);

    let unmounted = false;
    let unsubscribeLive: (() => void) | undefined;

    void (async () => {
      try {
        const session = await loadConversationSession(cid);
        if (unmounted) return;
        const entries = mapApiMessagesToChatEntries(session.entries);
        store.replace(entries);
        if (session.leafId) {
          activeLeafIdRef.current = session.leafId;
          setActiveLeafId(session.leafId);
        }
        unsubscribeLive = subscribeGlobalLive({
          onSseEvent: (ev) => {
            if (ev.conversationId !== cid) return;
            applySseToStore(store, pending, ev, followNewEntry);
          },
        });
      } catch (err) {
        console.error("[useChatSession] Failed to load conversation messages:", err);
      } finally {
        if (!unmounted) setIsSessionLoading(false);
      }
    })();

    return () => {
      unmounted = true;
      unsubscribeLive?.();
    };
  }, [boundCid, followNewEntry]);

  const setActiveLeaf = useCallback(
    async (entryId: string) => {
      if (!boundCid) return;
      if (!storeRef.current.getById(entryId)) {
        const session = await loadConversationSession(boundCid);
        storeRef.current.replace(mapApiMessagesToChatEntries(session.entries));
      }
      applyActiveLeaf(entryId);
      await setConversationDefaultViewLeaf(boundCid, entryId);
    },
    [boundCid, applyActiveLeaf],
  );

  const switchToBranch = useCallback(
    async (branchEntryId: string) => {
      const entries = storeRef.current.getRows().map((row$) => row$.get());
      await setActiveLeaf(branchLineTipId(branchEntryId, entries));
    },
    [setActiveLeaf],
  );

  const appendOptimisticUserMessage = useCallback(
    (input: AppendOptimisticUserMessageInput): OptimisticUserMessage | null => {
      const cid = String(input.conversationId || "").trim();
      if (!boundCid || cid !== boundCid) return null;
      const text = String(input.text || "").trim();
      if (!text) return null;
      const agentId = String(input.agentId || "").trim();
      if (!agentId) throw new Error("appendOptimisticUserMessage requires agentId");

      const path = buildActivePath(
        storeRef.current.getRows().map((row$) => row$.get()),
        activeLeafId,
      );
      const parentId = path.length > 0 ? path[path.length - 1].id : null;
      const clientRequestId = crypto.randomUUID();
      const rowId = `optimistic-user-${clientRequestId}`;
      pendingByClientRequestIdRef.current.set(clientRequestId, rowId);
      const row = buildOptimisticUserEntry({ ...input, text, agentId }, rowId, parentId);
      storeRef.current.append(row);
      followNewEntry(row);
      return { rowId, clientRequestId, parentId };
    },
    [boundCid, activeLeafId, followNewEntry],
  );

  return {
    activePathEntries,
    allEntries,
    isSessionLoading,
    setActiveLeaf,
    switchToBranch,
    appendOptimisticUserMessage,
  };
}
