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
