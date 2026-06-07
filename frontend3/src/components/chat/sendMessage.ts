import { postConversationMessage } from "@/api/client";

export async function sendMessageToConversation(
  conversationId: string,
  message: string,
  agentId: string,
): Promise<{ status: number }> {
  const { status } = await postConversationMessage(conversationId, {
    message,
    agentId,
  });
  return { status };
}
