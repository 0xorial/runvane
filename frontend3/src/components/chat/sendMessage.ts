import { postConversationMessage, type AttachmentMode, type PostMessageAttachment } from "@/api/client";
import type { UserMessageOverrides } from "../../../../backend/src/contracts/user-message-overrides";

export function defaultAttachmentMode(file: File): AttachmentMode {
  if (file.type.startsWith("image/")) return "direct";
  if (file.type.startsWith("text/")) return "direct";
  return "summary";
}
import type { LlmRef } from "../../../../backend/src/contracts/llm";

export type SendMessageResult = { ok: boolean };

export type MessageSendMode = {
  steer?: boolean;
  enqueue?: boolean;
};

export async function sendMessageToConversation(
  conversationId: string,
  message: string,
  agentId: string,
  llm: LlmRef | null,
  modelPresetId: number | null,
  attachments: PostMessageAttachment[],
  parentId: string | null,
  clientRequestId: string,
  opts?: { steer?: boolean; enqueue?: boolean; overrides?: UserMessageOverrides },
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
    ...(opts?.overrides ? { overrides: opts.overrides } : {}),
  });
  return { ok: status >= 200 && status < 300 };
}
