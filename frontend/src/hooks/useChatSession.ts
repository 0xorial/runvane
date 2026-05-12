import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getConversationMessages } from "../api/client";
import { subscribeGlobalLive, subscribeGlobalPoll } from "../protocol/runLiveClient";
import { defaultChatEntries, mapApiMessagesToChatEntries } from "../utils/chatEntries";
import { assertNever } from "../utils/assertNever";
import { SseType } from "../protocol/sseTypes";
import type { ChatAttachment, ChatEntry, UserMessageEntry } from "../protocol/chatEntry";
import { createObservableItemCollection } from "../utils/observableCollection";

export function useChatSession(conversationId: string | null | undefined) {
  const storeRef = useRef(createObservableItemCollection<ChatEntry>(defaultChatEntries));
  const liveDisposeRef = useRef<(() => void) | null>(null);
  const pollDisposeRef = useRef<(() => void) | null>(null);
  const pendingUserByConversationRef = useRef<Map<string, UserMessageEntry[]>>(new Map());

  const mergePendingUsers = useCallback((cid: string, fetched: ChatEntry[]): ChatEntry[] => {
    const pending = pendingUserByConversationRef.current.get(cid) ?? [];
    if (pending.length === 0) return fetched;
    const fetchedUsers = fetched.filter((entry): entry is UserMessageEntry => entry.type === "user-message");
    const fetchedCounts = new Map<string, number>();
    for (const row of fetchedUsers) {
      const key = row.text;
      fetchedCounts.set(key, (fetchedCounts.get(key) ?? 0) + 1);
    }
    const remaining: UserMessageEntry[] = [];
    for (const optimistic of pending) {
      const count = fetchedCounts.get(optimistic.text) ?? 0;
      if (count > 0) {
        fetchedCounts.set(optimistic.text, count - 1);
      } else {
        remaining.push(optimistic);
      }
    }
    if (remaining.length === 0) {
      pendingUserByConversationRef.current.delete(cid);
    } else {
      pendingUserByConversationRef.current.set(cid, remaining);
    }
    if (remaining.length === 0) return fetched;
    const startIndex = fetched.length;
    const optimisticRows = remaining.map((row, idx) => ({
      ...row,
      conversationIndex: startIndex + idx,
    }));
    return [...fetched, ...optimisticRows];
  }, []);

  const reloadMessages = useCallback(
    async (cid: string) => {
      const data = await getConversationMessages(cid);
      const fetched = mapApiMessagesToChatEntries(data);
      storeRef.current.replace(mergePendingUsers(cid, fetched));
    },
    [mergePendingUsers]
  );

  const reconcileIncomingUserMessage = useCallback((cid: string, incoming: UserMessageEntry): boolean => {
    const pending = pendingUserByConversationRef.current.get(cid) ?? [];
    if (pending.length === 0) return false;
    const matchIndex = pending.findIndex((p) => p.text === incoming.text);
    if (matchIndex < 0) return false;

    const matched = pending[matchIndex];
    const nextPending = [...pending.slice(0, matchIndex), ...pending.slice(matchIndex + 1)];
    if (nextPending.length === 0) pendingUserByConversationRef.current.delete(cid);
    else pendingUserByConversationRef.current.set(cid, nextPending);

    const current = storeRef.current.getRows().map((row$) => row$.get());
    const rowIndex = current.findIndex((row) => row.id === matched.id);
    if (rowIndex < 0) return false;
    const next = current.map((row) => ({ ...row }));
    next[rowIndex] = {
      ...incoming,
      conversationIndex: current[rowIndex].conversationIndex,
    };
    storeRef.current.replace(next);
    return true;
  }, []);

  useEffect(() => {
    if (!conversationId) {
      storeRef.current.replace(defaultChatEntries);
      return;
    }
    void reloadMessages(String(conversationId));
  }, [conversationId, reloadMessages]);

  useEffect(() => {
    liveDisposeRef.current?.();
    liveDisposeRef.current = null;
    pollDisposeRef.current?.();
    pollDisposeRef.current = null;
    if (!conversationId) return;

    const cid = String(conversationId);
    liveDisposeRef.current = subscribeGlobalLive({
      onSseEvent: (ev) => {
        if (ev.conversationId !== cid) return;
        if (ev.type === SseType.CONVERSATION_CREATED || ev.type === SseType.CONVERSATION_UPDATED) {
          return;
        }
        const store = storeRef.current;
        if (ev.type === SseType.USER_MESSAGE) {
          if (reconcileIncomingUserMessage(cid, ev.entry)) return;
          store.append(ev.entry);
          return;
        }
        if (ev.type === SseType.CHAT_ENTRY_UPSERT) {
          const row$ = store.getById(ev.entry.id);
          if (row$) {
            row$.mutate((next) => {
              Object.keys(next as Record<string, unknown>).forEach((key) => {
                delete (next as Record<string, unknown>)[key];
              });
              Object.assign(next as Record<string, unknown>, ev.entry as Record<string, unknown>);
            });
            store.touchRows();
            return;
          }
          store.append(ev.entry);
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
          store.touchRows();
          return;
        }
        if (ev.type === SseType.TOOL_INVOCATION_START || ev.type === SseType.TOOL_INVOCATION_END) {
          return;
        }
        assertNever(ev);
      },
    });
    pollDisposeRef.current = subscribeGlobalPoll(async () => false);

    return () => {
      liveDisposeRef.current?.();
      liveDisposeRef.current = null;
      pollDisposeRef.current?.();
      pollDisposeRef.current = null;
    };
  }, [conversationId, reconcileIncomingUserMessage]);

  useEffect(() => {
    if (!conversationId) return;
    const cid = String(conversationId);
    const handler = () => {
      void reloadMessages(cid);
    };
    window.addEventListener("runvane:refresh-chat", handler);
    return () => window.removeEventListener("runvane:refresh-chat", handler);
  }, [conversationId, reloadMessages]);

  const subscribeRows = useCallback((listener: () => void) => storeRef.current.subscribeRows(listener), []);
  const getRowsVersion = useCallback(() => storeRef.current.getRowsVersion(), []);
  useSyncExternalStore(subscribeRows, getRowsVersion, getRowsVersion);
  const chatEntries = storeRef.current.getRows();

  const appendOptimisticUserMessage = useCallback(
    (input: {
      conversationId: string;
      text: string;
      agentId: string;
      llmProviderId?: string;
      llmModel?: string;
      modelPresetId?: number | null;
      attachments?: ChatAttachment[];
    }): string | null => {
      const cid = String(input.conversationId || "").trim();
      if (!cid) return null;
      const text = String(input.text || "").trim();
      if (!text) return null;
      const agentId = String(input.agentId || "").trim();
      if (!agentId) {
        throw new Error("appendOptimisticUserMessage requires agentId");
      }
      const row: UserMessageEntry = {
        type: "user-message",
        id: `optimistic-user-${crypto.randomUUID()}`,
        conversationIndex: storeRef.current.getRows().length,
        createdAt: new Date().toISOString(),
        parentId: null,
        text,
        agentId,
        ...(input.llmProviderId ? { llmProviderId: input.llmProviderId } : {}),
        ...(input.llmModel ? { llmModel: input.llmModel } : {}),
        ...(input.modelPresetId != null ? { modelPresetId: input.modelPresetId } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      };
      const current = pendingUserByConversationRef.current.get(cid) ?? [];
      pendingUserByConversationRef.current.set(cid, [...current, row]);
      storeRef.current.append(row);
      return row.id;
    },
    []
  );

  return {
    chatEntries,
    appendOptimisticUserMessage,
  };
}
