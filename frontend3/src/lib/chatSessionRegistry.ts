import type { SseEvent } from "@/protocol/sseTypes";
import { subscribeGlobalLive } from "@/protocol/runLiveClient";
import { ChatSessionStore } from "./chatSessionStore";

const stores = new Map<string, ChatSessionStore>();
const pendingByConversationId = new Map<string, Map<string, string>>();
let emptyStore: ChatSessionStore | undefined;

export function routeSessionSseEvent(ev: SseEvent): void {
  const cid = String(ev.conversationId || "").trim();
  if (!cid) return;
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
