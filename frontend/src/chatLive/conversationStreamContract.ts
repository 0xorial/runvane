/**
 * USER_INVARIANT[RV-005]: Global SSE contract for `GET /api/stream`.
 * Chat consumers should filter by `conversation_id`.
 */

export function sseEventBelongsToConversation(
  eventConversationId: string | null,
  conversationId: string,
): boolean {
  return (
    typeof eventConversationId === "string" &&
    eventConversationId.length > 0 &&
    eventConversationId === String(conversationId)
  );
}
