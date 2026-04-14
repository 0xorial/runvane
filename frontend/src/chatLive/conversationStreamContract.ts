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
