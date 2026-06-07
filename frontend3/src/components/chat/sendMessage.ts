import { postConversationMessage, type PostMessageAttachment } from "@/api/client";
import type { LlmRef } from "../../../../backend/src/contracts/llm";

export type SendMessageResult = { ok: boolean };

export async function sendMessageToConversation(
  conversationId: string,
  message: string,
  agentId: string,
  llm: LlmRef | null,
  modelPresetId: number | null,
  attachments: PostMessageAttachment[],
  parentId: string | null,
  clientRequestId: string,
  opts?: { steer?: boolean; enqueue?: boolean },
): Promise<SendMessageResult> {
  const { status } = await postConversationMessage(conversationId, {
    message,
    agentId,
    ...(llm ? { llm } : {}),
    ...(modelPresetId != null ? { modelPresetId } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    parentId,
    clientRequestId,
    ...(opts?.steer ? { steer: true } : {}),
    ...(opts?.enqueue ? { enqueue: true } : {}),
  });
  return { ok: status >= 200 && status < 300 };
}
