import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getConversationDefaultViewLeafEntryId, getConversationMessages, setConversationDefaultViewLeaf } from "../api/client";
import { subscribeGlobalLive, subscribeGlobalPoll } from "../protocol/runLiveClient";
import { defaultChatEntries, mapApiMessagesToChatEntries } from "../utils/chatEntries";
import { assertNever } from "../utils/assertNever";
import { SseType } from "../protocol/sseTypes";
import type { ChatAttachment, ChatEntry, UserMessageEntry } from "../protocol/chatEntry";
import { createObservableItemCollection, type ObservableItem } from "../utils/observableCollection";

type AppendOptimisticUserMessageInput = {
  conversationId: string;
  text: string;
  agentId: string;
  llmProviderId?: string;
  llmModel?: string;
  modelPresetId?: number | null;
  attachments?: ChatAttachment[];
};

function buildOptimisticUserEntry(input: AppendOptimisticUserMessageInput, parentId: string | null): UserMessageEntry {
  return {
    type: "user-message",
    id: `optimistic-user-${crypto.randomUUID()}`,
    conversationIndex: -1,
    createdAt: new Date().toISOString(),
    parentId,
    text: input.text,
    agentId: input.agentId,
    ...(input.llmProviderId ? { llmProviderId: input.llmProviderId } : {}),
    ...(input.llmModel ? { llmModel: input.llmModel } : {}),
    ...(input.modelPresetId != null ? { modelPresetId: input.modelPresetId } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  };
}

export function useChatSession(conversationId: string | null | undefined) {
  const storeRef = useRef(createObservableItemCollection<ChatEntry>(defaultChatEntries));
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const pendingOptimisticUsersRef = useRef<Map<string, UserMessageEntry[]>>(new Map());

  useEffect(() => {
    storeRef.current.replace(defaultChatEntries);
    setActiveLeafId(null);
    if (!conversationId) return;

    const cid = String(conversationId);
    let cancelled = false;
    void (async () => {
      const [entries, leafId] = await Promise.all([
        getConversationMessages(cid, { all: true }),
        getConversationDefaultViewLeafEntryId(cid),
      ]);
      if (cancelled) return;
      const store = storeRef.current;
      store.replace(mapApiMessagesToChatEntries(entries));
      setActiveLeafId(leafId);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const reconcileOptimisticUserMessage = useCallback((cid: string, incoming: UserMessageEntry): boolean => {
    const pending = pendingOptimisticUsersRef.current.get(cid) ?? [];
    const matchIndex = pending.findIndex((p) => p.text === incoming.text);
    if (matchIndex < 0) return false;

    const matched = pending[matchIndex];
    const nextPending = [...pending.slice(0, matchIndex), ...pending.slice(matchIndex + 1)];
    if (nextPending.length === 0) pendingOptimisticUsersRef.current.delete(cid);
    else pendingOptimisticUsersRef.current.set(cid, nextPending);

    const allRows = storeRef.current.getRows();
    const filtered = allRows.filter((r) => r.id !== matched.id).map((r) => r.get());
    filtered.push(incoming);
    storeRef.current.replace(filtered);
    setActiveLeafId(incoming.id);
    return true;
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    const cid = String(conversationId);
    const unsubscribeLive = subscribeGlobalLive({
      onSseEvent: (ev) => {
        if (ev.conversationId !== cid) return;
        if (ev.type === SseType.CONVERSATION_CREATED || ev.type === SseType.CONVERSATION_UPDATED) {
          return;
        }
        const store = storeRef.current;
        if (ev.type === SseType.USER_MESSAGE) {
          if (reconcileOptimisticUserMessage(cid, ev.entry)) return;
          if (store.append(ev.entry)) setActiveLeafId(ev.entry.id);
          return;
        }
        if (ev.type === SseType.CHAT_ENTRY_UPSERT) {
          const row$ = store.getById(ev.entry.id);
          if (row$) {
            row$.mutate((next) => {
              const target = next as Record<string, unknown>;
              for (const key of Object.keys(target)) delete target[key];
              Object.assign(target, ev.entry as Record<string, unknown>);
            });
            return;
          }
          if (store.append(ev.entry)) setActiveLeafId(ev.entry.id);
          return;
        }
        if (ev.type === SseType.CHAT_ENTRY_DELTA) {
          const row$ = store.getById(ev.chatEntryId);
          if (!row$) return;
          row$.mutate((next) => {
            const target = next as Record<string, unknown>;
            const current = typeof target[ev.field] === "string" ? (target[ev.field] as string) : "";
            target[ev.field] = `${current}${ev.delta}`;
          });
          return;
        }
        if (ev.type === SseType.TOOL_INVOCATION_START || ev.type === SseType.TOOL_INVOCATION_END) {
          return;
        }
        assertNever(ev);
      },
    });
    const unsubscribePoll = subscribeGlobalPoll(async () => false);

    return () => {
      unsubscribeLive();
      unsubscribePoll();
    };
  }, [conversationId, reconcileOptimisticUserMessage]);

  const subscribeRows = useCallback((listener: () => void) => storeRef.current.subscribeRows(listener), []);
  const getRowsVersion = useCallback(() => storeRef.current.getRowsVersion(), []);
  const rowsVersion = useSyncExternalStore(subscribeRows, getRowsVersion, getRowsVersion);

  const allEntries = useMemo(() => storeRef.current.getRows().slice(), [rowsVersion]);

  const activePathEntries = useMemo<ObservableItem<ChatEntry>[]>(() => {
    void rowsVersion;
    if (!activeLeafId) return [];
    const path: ObservableItem<ChatEntry>[] = [];
    const seen = new Set<string>();
    let cursorId: string | null = activeLeafId;
    while (cursorId && !seen.has(cursorId)) {
      seen.add(cursorId);
      const node = storeRef.current.getById(cursorId);
      if (!node) break;
      path.push(node);
      cursorId = node.get().parentId;
    }
    return path.reverse();
  }, [activeLeafId, rowsVersion]);

  const setActiveLeaf = useCallback(
    async (entryId: string) => {
      if (!conversationId) return;
      setActiveLeafId(entryId);
      await setConversationDefaultViewLeaf(String(conversationId), entryId);
    },
    [conversationId]
  );

  const appendOptimisticUserMessage = useCallback(
    (input: AppendOptimisticUserMessageInput): string | null => {
      const cid = String(input.conversationId || "").trim();
      if (!cid) return null;
      const text = String(input.text || "").trim();
      if (!text) return null;
      const agentId = String(input.agentId || "").trim();
      if (!agentId) {
        throw new Error("appendOptimisticUserMessage requires agentId");
      }
      const row = buildOptimisticUserEntry({ ...input, text, agentId }, activeLeafId);
      const current = pendingOptimisticUsersRef.current.get(cid) ?? [];
      pendingOptimisticUsersRef.current.set(cid, [...current, row]);
      storeRef.current.append(row);
      setActiveLeafId(row.id);
      return row.id;
    },
    [activeLeafId]
  );

  return {
    activePathEntries,
    allEntries,
    activeLeafId,
    setActiveLeaf,
    appendOptimisticUserMessage,
  };
}
