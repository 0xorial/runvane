import { z } from "zod";

import type { ChatEntry } from "../types/chatEntry.js";
import { ChatEntrySchema } from "../types/chatEntry.js";

export type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  prompt_tokens_total: number;
  completion_tokens_total: number;
  estimated_cost_usd?: number;
};
export type CreateConversationRequest = {
  title?: string;
};
export type ChatMessageEntry = ChatEntry;
export type PostConversationMessageRequest = {
  message: string;
  agent_id: string;
  llm_provider_id?: string;
  llm_model?: string;
  model_preset_id?: number;
  attachment_ids?: string[];
};
export type PostConversationMessageAcceptedResponse = {
  conversation_id: string;
};

const ConversationRowSchema: z.ZodType<ConversationRow> = z.object({
  id: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  prompt_tokens_total: z.number().finite(),
  completion_tokens_total: z.number().finite(),
  estimated_cost_usd: z.number().finite().optional(),
});

const CreateConversationRequestSchema: z.ZodType<CreateConversationRequest> = z.object({
  title: z.string().optional(),
});
const PostConversationMessageRequestSchema: z.ZodType<PostConversationMessageRequest> = z.object({
  message: z.string(),
  agent_id: z.string(),
  llm_provider_id: z.string().optional(),
  llm_model: z.string().optional(),
  model_preset_id: z.number().finite().optional(),
  attachment_ids: z.array(z.string()).optional(),
});
const PostConversationMessageAcceptedResponseSchema: z.ZodType<PostConversationMessageAcceptedResponse> =
  z.object({
    conversation_id: z.string(),
  });

const RenameConversationRequestSchema = z.object({
  title: z.string(),
});

export function parseCreateConversationTitle(body: Record<string, unknown>): string {
  const parsed = CreateConversationRequestSchema.safeParse(body);
  if (!parsed.success) return "New chat";
  return typeof parsed.data.title === "string" ? parsed.data.title : "New chat";
}

export function parseRenameConversationTitle(body: Record<string, unknown>): string {
  const parsed = RenameConversationRequestSchema.safeParse(body);
  return parsed.success ? parsed.data.title : "";
}

export function toPostConversationMessageAcceptedResponse(
  conversationId: string
): PostConversationMessageAcceptedResponse {
  return { conversation_id: conversationId };
}

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues
    .map((i) => `${context}.${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
  return new Error(`${context} validation failed: ${details}`);
}

function parseChatMessageEntry(value: unknown, index: number): ChatMessageEntry {
  const parsed = ChatEntrySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    const role = rec.role;
    if (role === "user" || role === "assistant") {
      return {
        type: role === "user" ? "user-message" : "assistant-message",
        id: typeof rec.id === "string" ? rec.id : "",
        text: typeof rec.text === "string" ? rec.text : "",
        conversationIndex:
          typeof rec.conversationIndex === "number" && Number.isFinite(rec.conversationIndex)
            ? rec.conversationIndex
            : index,
        createdAt:
          typeof rec.createdAt === "string"
            ? rec.createdAt
            : typeof rec.created_at === "string"
              ? rec.created_at
              : new Date().toISOString(),
      };
    }
  }
  throw formatZodError("GET /api/conversations/:id/messages", parsed.error);
}

export function validateConversationRowResponse(value: unknown, context: string): ConversationRow {
  const parsed = ConversationRowSchema.safeParse(value);
  if (!parsed.success) throw formatZodError(context, parsed.error);
  return parsed.data;
}

export function validateGetConversationsResponse(data: unknown): ConversationRow[] {
  const parsed = z.array(ConversationRowSchema).safeParse(data);
  if (!parsed.success) throw formatZodError("GET /api/conversations", parsed.error);
  return parsed.data;
}

export function validatePostConversationsResponse(data: unknown): ConversationRow {
  return validateConversationRowResponse(data, "POST /api/conversations");
}

export function validateConversationMessagesPath(path: string): boolean {
  return /^\/api\/conversations\/[^/]+\/messages$/.test(path);
}

export function validateGetConversationMessagesResponse(data: unknown): ChatMessageEntry[] {
  const arr = z.array(z.unknown()).safeParse(data);
  if (!arr.success) throw formatZodError("GET /api/conversations/:id/messages", arr.error);
  return arr.data.map((row, i) => parseChatMessageEntry(row, i));
}

export function validatePostConversationMessageResponse(
  data: unknown
): PostConversationMessageAcceptedResponse {
  const parsed = PostConversationMessageAcceptedResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError("POST /api/conversations/:id/messages", parsed.error);
  return parsed.data;
}

export function validatePostConversationMessageRequest(
  data: unknown
): PostConversationMessageRequest {
  const parsed = PostConversationMessageRequestSchema.safeParse(data);
  if (!parsed.success) {
    throw formatZodError("POST /api/conversations/:id/messages request", parsed.error);
  }
  return parsed.data;
}
