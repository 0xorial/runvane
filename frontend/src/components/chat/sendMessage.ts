import { postConversationMessage, type AttachmentMode, type PostMessageAttachment } from "../../api/client";
import type { AsyncResult } from "../ui/AsyncButton";
import type { LlmRef } from "../../../../backend/src/contracts/llm";

export async function sendMessageToConversation(
  conversationId: string,
  message: string,
  agentId: string,
  llm: LlmRef | null,
  modelPresetId: number | null,
  attachments: PostMessageAttachment[],
  parentId: string | null,
  clientRequestId: string,
): Promise<AsyncResult> {
  const { status } = await postConversationMessage(conversationId, {
    message,
    agentId,
    ...(llm ? { llm } : {}),
    ...(modelPresetId != null ? { modelPresetId } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    parentId,
    clientRequestId,
  });
  return { ok: status >= 200 && status < 300 };
}

/** Default delivery mode for a freshly-picked file. */
export function defaultAttachmentMode(file: File): AttachmentMode {
  if (file.type.startsWith("image/")) return "direct";
  if (file.type.startsWith("text/")) return "direct";
  return "summary";
}
