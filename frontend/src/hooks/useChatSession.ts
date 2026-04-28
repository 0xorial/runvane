import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getConversationMessages } from "../api/client";
import { subscribeGlobalLive, subscribeGlobalPoll } from "../protocol/runLiveClient";
import { defaultChatEntries, mapApiMessagesToChatEntries } from "../utils/chatEntries";
import { assertNever } from "../utils/assertNever";
import { SseType } from "../protocol/sseTypes";
import type { ChatAttachment, ChatEntry, UserMessageEntry } from "../protocol/chatEntry";
import { createObservableItemCollection } from "../utils/observableCollection";
import { TokenUsageMapper } from "../../../backend/src/types/tokenUsage";

function plannerResponseUsageFromEvent(ev: {
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
}) {
  return TokenUsageMapper.fromEntryFields({
    promptTokens: ev.promptTokens,
    cachedPromptTokens: ev.cachedPromptTokens,
    completionTokens: ev.completionTokens,
  });
}

export function useChatSession(conversationId: string | null | undefined) {
  const storeRef = useRef(createObservableItemCollection<ChatEntry>(defaultChatEntries));
  const liveDisposeRef = useRef<(() => void) | null>(null);
  const pollDisposeRef = useRef<(() => void) | null>(null);
  const pendingUserByConversationRef = useRef<Map<string, UserMessageEntry[]>>(new Map());
  const pendingAssistantByEntryIdRef = useRef<Map<string, { delta: string; parentId: string | null }>>(new Map());
  const pendingToolStartByEntryIdRef = useRef<
    Map<string, { toolName: string; approvalRequired: boolean; argsPreview?: string; parentId: string | null }>
  >(new Map());

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
        if (ev.type === SseType.USER_MESSAGE) {
          const store = storeRef.current;
          if (reconcileIncomingUserMessage(cid, ev.entry)) return;
          store.append(ev.entry);
          return;
        } else if (ev.type === SseType.CHAT_ENTRY_UPSERT) {
          const store = storeRef.current;
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
        } else if (ev.type === SseType.PLANNER_STARTING || ev.type === SseType.TITLE_STARTING) {
          const store = storeRef.current;
          const thinkingType = ev.type === SseType.TITLE_STARTING ? "title_llm_stream" : "planner_llm_stream";
          if (!store.getById(ev.chatEntryId)) {
            const llmProviderId =
              typeof ev.llmProviderId === "string" && ev.llmProviderId.trim() !== ""
                ? ev.llmProviderId.trim()
                : undefined;
            const llmModel =
              typeof ev.llmModel === "string" && ev.llmModel.trim() !== "" ? ev.llmModel.trim() : undefined;
            store.append({
              type: thinkingType,
              id: ev.chatEntryId,
              thoughtId: ev.thoughtId,
              conversationIndex: ev.conversationIndex,
              createdAt: ev.createdAt,
              parentId: ev.parentId ?? null,
              llmRequest: ev.requestText,
              status: "running",
              ...(llmProviderId !== undefined ? { llmProviderId } : {}),
              ...(llmModel !== undefined ? { llmModel } : {}),
            });
          }
          return;
        } else if (ev.type === SseType.PLANNER_LLM_STREAM || ev.type === SseType.TITLE_LLM_STREAM) {
          const store = storeRef.current;
          const row$ = store.getById(ev.chatEntryId);
          if (!row$) {
            return;
          }
          row$.mutate((next) => {
            if (next.type !== "planner_llm_stream" && next.type !== "title_llm_stream") {
              console.warn("Expected planner_llm_stream row, got:", next.type);
              return;
            }
            next.llmResponse = `${next.llmResponse ?? ""}${ev.delta}`;
            next.status = "running";
            delete next.error;
          });
          store.touchRows();
          return;
        } else if (ev.type === SseType.ASSISTANT_STREAM) {
          const store = storeRef.current;
          const row$ = store.getById(ev.chatEntryId);
          if (!row$) {
            const pending = pendingAssistantByEntryIdRef.current.get(ev.chatEntryId);
            const parentId = ev.parentId ?? pending?.parentId ?? null;
            const delta = `${pending?.delta ?? ""}${ev.delta}`;
            pendingAssistantByEntryIdRef.current.delete(ev.chatEntryId);
            store.append({
              type: "assistant-message",
              id: ev.chatEntryId,
              conversationIndex: store.getRows().length,
              createdAt: new Date().toISOString(),
              parentId,
              text: delta,
            });
            return;
          }
          row$.mutate((next) => {
            if (next.type !== "assistant-message") return;
            next.text = `${next.text}${ev.delta}`;
          });
          store.touchRows();
          return;
        } else if (ev.type === SseType.PLANNER_RESPONSE || ev.type === SseType.TITLE_RESPONSE) {
          const store = storeRef.current;
          const row$ = store.getById(ev.chatEntryId);

          if (row$) {
            row$.mutate((next) => {
              if (next.type !== "planner_llm_stream" && next.type !== "title_llm_stream") {
                console.warn("Expected planner_llm_stream row, got:", next.type);
                return;
              }
              next.decision =
                ev.type === SseType.PLANNER_RESPONSE && ev.action === "tool_call" && ev.toolName
                  ? {
                      type: "tool-invocation",
                      toolId: ev.toolName,
                      parameters: {},
                    }
                  : ev.summary.trim()
                  ? {
                      type: "user-response",
                      text: ev.summary.trim(),
                    }
                  : next.decision ?? null;
              const createdAtMs = Date.parse(next.createdAt);
              next.thoughtMs =
                ev.finished && Number.isFinite(createdAtMs)
                  ? Math.max(0, Date.now() - createdAtMs)
                  : next.thoughtMs ?? null;
              if (ev.action === "failed") {
                next.status = "failed";
                next.error = ev.summary;
              } else if (ev.action === "cancelled") {
                next.status = "cancelled";
                next.error = ev.summary;
              } else if (ev.finished) {
                next.status = "completed";
                delete next.error;
              }
              const modelWire = typeof ev.llmModel === "string" ? ev.llmModel.trim() : "";
              const providerWire = typeof ev.llmProviderId === "string" ? ev.llmProviderId.trim() : "";
              if (providerWire) next.llmProviderId = providerWire;
              if (modelWire) next.llmModel = modelWire;
              const usage = plannerResponseUsageFromEvent(ev);
              if (usage) {
                next.promptTokens = usage.promptTokens;
                next.completionTokens = usage.completionTokens;
                if (usage.cachedPromptTokens !== undefined) {
                  next.cachedPromptTokens = usage.cachedPromptTokens;
                }
              }
            });
            store.touchRows();
          }
          return;
        } else if (ev.type === SseType.TOOL_INVOCATION_START) {
          const store = storeRef.current;
          const existing = store.getById(ev.chatEntryId);
          if (existing) {
            existing.mutate((next) => {
              if (next.type !== "tool-invocation") return;
              next.toolId = ev.toolName;
              next.state = ev.approvalRequired ? "requested" : "running";
              if (typeof ev.parentId === "string" && ev.parentId.trim() !== "") {
                next.parentId = ev.parentId;
              }
              next.parameters = ev.argsPreview ? { argsPreview: ev.argsPreview } : next.parameters;
            });
            store.touchRows();
            return;
          }
          const pending = pendingToolStartByEntryIdRef.current.get(ev.chatEntryId);
          const parentId = ev.parentId ?? pending?.parentId ?? null;
          const toolName = ev.toolName || pending?.toolName || "unknown";
          const approvalRequired = ev.approvalRequired ?? pending?.approvalRequired ?? false;
          const argsPreview = ev.argsPreview ?? pending?.argsPreview;
          pendingToolStartByEntryIdRef.current.delete(ev.chatEntryId);
          store.append({
            type: "tool-invocation",
            id: ev.chatEntryId,
            conversationIndex: store.getRows().length,
            createdAt: new Date().toISOString(),
            parentId,
            toolId: toolName,
            state: approvalRequired ? "requested" : "running",
            parameters: argsPreview ? { argsPreview } : {},
            result: null,
          });
          return;
        } else if (ev.type === SseType.TOOL_INVOCATION_END) {
          const store = storeRef.current;
          const rows = store.getRows();
          const idx = store.findLastIndex(
            (e) =>
              e.type === "tool-invocation" &&
              e.toolId === ev.toolName &&
              (e.state === "requested" || e.state === "running")
          );
          if (idx < 0) return;
          const row$ = rows[idx];
          const row = row$.get();
          if (row.type !== "tool-invocation") return;
          row$.mutate((next) => {
            if (next.type !== "tool-invocation") return;
            next.state = ev.ok ? "done" : "error";
            next.result = ev.output;
          });
          store.touchRows();
        } else assertNever(ev);
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
