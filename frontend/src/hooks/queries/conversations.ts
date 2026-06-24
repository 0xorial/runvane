import type { ConversationRow, GetConversationsResponse } from "../../../../backend/src/contracts/conversations";
import type { ConversationSseRow } from "../../../../backend/src/contracts/sse";
import {
  getConversation,
  getConversationMessages,
  getConversations,
} from "../../api/client";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "./keys";

export type ConversationSession = {
  entries: Awaited<ReturnType<typeof getConversationMessages>>["entries"];
  /** SSE seq watermark the entries reflect; the client applies live events after it. */
  seq: number;
  anchorId: string | null;
  leafId: string | null;
};

export async function loadConversationSession(conversationId: string): Promise<ConversationSession> {
  const cid = conversationId.trim();
  const [snapshot, conversation] = await Promise.all([
    getConversationMessages(cid, { all: true }),
    getConversation(cid),
  ]);
  queryClient.setQueryData(queryKeys.conversation(cid), conversation);
  return {
    entries: snapshot.entries,
    seq: snapshot.seq,
    anchorId: conversation.defaultViewLeafAnchorId ?? null,
    leafId: conversation.defaultViewLeafEntryId,
  };
}

export function fetchConversationSession(conversationId: string): Promise<ConversationSession> {
  const cid = conversationId.trim();
  return queryClient.fetchQuery({
    queryKey: queryKeys.conversationSession(cid),
    queryFn: () => loadConversationSession(cid),
    staleTime: 60_000,
  });
}

export function refreshConversations(deletedOnly: boolean): Promise<GetConversationsResponse> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.conversationList(deletedOnly),
    queryFn: () => getConversations({ deletedOnly }),
  });
}

export function patchConversationsList(
  deletedOnly: boolean,
  updater: (prev: GetConversationsResponse) => GetConversationsResponse,
): void {
  queryClient.setQueryData<GetConversationsResponse>(queryKeys.conversationList(deletedOnly), (prev) => {
    if (!prev) return prev;
    return updater(prev);
  });
}

export function upsertConversationInList(deletedOnly: boolean, conversation: ConversationRow): void {
  patchConversationsList(deletedOnly, (prev) => {
    if (!prev) return prev;
    const index = prev.conversations.findIndex((item) => item.id === conversation.id);
    if (index < 0) {
      return { ...prev, conversations: [conversation, ...prev.conversations] };
    }
    const next = prev.conversations.slice();
    next[index] = { ...next[index], ...conversation };
    return { ...prev, conversations: next };
  });
}

export function mergeSseConversation(
  previous: ConversationRow | undefined,
  incoming: ConversationSseRow,
): ConversationRow {
  return {
    ...incoming,
    // The SSE row doesn't carry the pin flag; keep the last known value (new
    // conversations default to unpinned). A REST list refetch corrects it.
    groupPinned: previous?.groupPinned ?? false,
    defaultViewLeafAnchorId: incoming.defaultViewLeafAnchorId,
    defaultViewLeafEntryId: previous?.defaultViewLeafEntryId ?? null,
    // Fork provenance isn't carried on SSE rows (it's immutable post-creation);
    // keep whatever the authoritative GET /:id fetch already cached.
    forkedFromConversationId: previous?.forkedFromConversationId ?? null,
    forkedFromEntryId: previous?.forkedFromEntryId ?? null,
    forkedFromConversationTitle: previous?.forkedFromConversationTitle ?? null,
  };
}
