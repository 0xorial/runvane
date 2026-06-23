import type { SseEvent } from "@/protocol/sseTypes";
import { subscribeGlobalLive } from "@/protocol/runLiveClient";
import { parseSseEventObject } from "@/protocol/parseSseEventObject";
import { API_BASE_URL } from "@/api/client";
import { ChatSessionStore } from "./chatSessionStore";

const stores = new Map<string, ChatSessionStore>();
const pendingByConversationId = new Map<string, Map<string, string>>();
let emptyStore: ChatSessionStore | undefined;
/** Conversations with their own SSE stream; the global stream skips these. */
const perConvActive = new Set<string>();

export function routeSessionSseEvent(ev: SseEvent): void {
  const cid = String(ev.conversationId || "").trim();
  if (!cid) return;
  if (perConvActive.has(cid)) return; // its per-conversation stream owns entries
  const store = stores.get(cid);
  if (!store) return;
  const pending = pendingByConversationId.get(cid);
  if (!pending) return;
  store.applySseEvent(ev, pending);
}

export function resetChatSessionRegistry(): void {
  stores.clear();
  pendingByConversationId.clear();
}

function ensureLiveSubscription(): void {
  if (liveDispose) return;
  liveDispose = subscribeGlobalLive({
    onSseEvent: routeSessionSseEvent,
  });
}

let liveDispose: (() => void) | undefined;

export function getEmptyChatSessionStore(): ChatSessionStore {
  emptyStore ??= new ChatSessionStore();
  return emptyStore;
}

export function getChatSessionStore(conversationId: string): ChatSessionStore {
  const cid = conversationId.trim();
  let store = stores.get(cid);
  if (!store) {
    store = new ChatSessionStore();
    stores.set(cid, store);
  }
  if (!pendingByConversationId.has(cid)) {
    pendingByConversationId.set(cid, new Map());
  }
  return store;
}

export function getChatSessionPending(conversationId: string): Map<string, string> {
  const cid = conversationId.trim();
  getChatSessionStore(cid);
  return pendingByConversationId.get(cid)!;
}

/**
 * Subscribe a conversation to its own SSE stream. The first frame is the
 * snapshot (seeds the store + baselines the watermark); later frames are live
 * mutations the store gates by seq. EventSource auto-reconnects and the server
 * resends a snapshot as the first frame each time — so reconnect == re-snapshot,
 * no manual recovery. While active, the global stream skips this conversation.
 */
export function subscribeConversationStream(conversationId: string): () => void {
  const cid = conversationId.trim();
  const store = getChatSessionStore(cid);
  const pending = getChatSessionPending(cid);
  perConvActive.add(cid);
  const es = new EventSource(`${API_BASE_URL}/api/conversations/${encodeURIComponent(cid)}/stream`);
  es.onmessage = (e) => {
    try {
      const ev = parseSseEventObject(JSON.parse(e.data) as unknown);
      if (ev && String(ev.conversationId).trim() === cid) store.applySseEvent(ev, pending);
    } catch (err) {
      console.error("[runvane] conversation stream parse error", err);
    }
  };
  return () => {
    es.close();
    perConvActive.delete(cid);
  };
}

/** Route SSE to cached session stores for the app lifetime (no gap on chat switch). */
export function retainChatSessionLive(): () => void {
  ensureLiveSubscription();
  return () => {};
}

export function dropChatSessionStore(conversationId: string): void {
  const cid = conversationId.trim();
  stores.delete(cid);
  pendingByConversationId.delete(cid);
}

ensureLiveSubscription();
