import { useQuery } from "@tanstack/react-query";
import type { ConversationRow, GetConversationsResponse } from "../../../../backend/src/contracts/conversations";
import type { ConversationSseRow } from "../../../../backend/src/contracts/sse";
import {
  getConversation,
  getConversationMessages,
  getConversations,
} from "../../api/client";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "./keys";

export function useConversationsQuery(deletedOnly: boolean) {
  return useQuery({
    queryKey: queryKeys.conversationList(deletedOnly),
    queryFn: () => getConversations({ deletedOnly }),
  });
}

export function useConversationQuery(conversationId: string | null | undefined) {
  const id = conversationId?.trim() || "";
  return useQuery({
    queryKey: queryKeys.conversation(id),
    queryFn: () => getConversation(id),
    enabled: id.length > 0,
  });
}

export type ConversationSession = {
  entries: Awaited<ReturnType<typeof getConversationMessages>>;
  anchorId: string | null;
  leafId: string | null;
};

export async function loadConversationSession(conversationId: string): Promise<ConversationSession> {
  const cid = conversationId.trim();
  const [entries, conversation] = await Promise.all([
    getConversationMessages(cid, { all: true }),
    getConversation(cid),
  ]);
  queryClient.setQueryData(queryKeys.conversation(cid), conversation);
  return {
    entries,
    anchorId: conversation.defaultViewLeafAnchorId ?? null,
    leafId: conversation.defaultViewLeafEntryId,
  };
}

export function fetchConversationSession(conversationId: string): Promise<ConversationSession> {
  const cid = conversationId.trim();
  return queryClient.fetchQuery({
    queryKey: queryKeys.conversationSession(cid),
    queryFn: () => loadConversationSession(cid),
    staleTime: 0,
  });
}

export async function refetchConversationSession(conversationId: string): Promise<ConversationSession> {
  const cid = conversationId.trim();
  await queryClient.invalidateQueries({ queryKey: queryKeys.conversationSession(cid) });
  return fetchConversationSession(cid);
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

export function mergeSseConversation(
  previous: ConversationRow | undefined,
  incoming: ConversationSseRow,
): ConversationRow {
  return {
    ...incoming,
    defaultViewLeafAnchorId: incoming.defaultViewLeafAnchorId,
    defaultViewLeafEntryId: previous?.defaultViewLeafEntryId ?? null,
  };
}

export function upsertConversationInList(deletedOnly: boolean, conversation: ConversationRow): void {
  patchConversationsList(deletedOnly, (prev) => {
    const index = prev.conversations.findIndex((item) => item.id === conversation.id);
    if (index < 0) {
      return { ...prev, conversations: [conversation, ...prev.conversations] };
    }
    const next = prev.conversations.slice();
    next[index] = { ...next[index], ...conversation };
    return { ...prev, conversations: next };
  });
}

export function removeConversationFromList(deletedOnly: boolean, conversationId: string): void {
  patchConversationsList(deletedOnly, (prev) => ({
    ...prev,
    conversations: prev.conversations.filter((item) => item.id !== conversationId),
  }));
}

export function invalidateConversationSession(conversationId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.conversationSession(conversationId.trim()) });
}
