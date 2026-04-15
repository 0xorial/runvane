import { z } from "zod";

import type { ChatEntry } from "../types/chatEntry.js";
import { ChatEntrySchema } from "../types/chatEntry.js";

export type ConversationRow = {
  id: string;
  title: string;
  group_id: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  prompt_tokens_total: number;
  cached_prompt_tokens_total: number;
  completion_tokens_total: number;
  token_usage_by_model: Array<{
    model_name: string;
    prompt_tokens: number;
    cached_prompt_tokens: number;
    completion_tokens: number;
  }>;
};
export type ConversationGroupRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};
export type GetConversationsResponse = {
  conversations: ConversationRow[];
  groups: ConversationGroupRow[];
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
  group_id: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  prompt_tokens_total: z.number().finite(),
  cached_prompt_tokens_total: z.number().finite(),
  completion_tokens_total: z.number().finite(),
  token_usage_by_model: z.array(
    z.object({
      model_name: z.string(),
      prompt_tokens: z.number().finite(),
      cached_prompt_tokens: z.number().finite(),
      completion_tokens: z.number().finite(),
    }),
  ),
});
const ConversationGroupRowSchema: z.ZodType<ConversationGroupRow> = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
const GetConversationsResponseSchema: z.ZodType<GetConversationsResponse> = z.object({
  conversations: z.array(ConversationRowSchema),
  groups: z.array(ConversationGroupRowSchema),
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
const PostConversationMessageAcceptedResponseSchema: z.ZodType<PostConversationMessageAcceptedResponse> = z.object({
  conversation_id: z.string(),
});

const UpdateConversationRequestSchema = z.object({
  title: z.string().optional(),
  group_id: z.string().nullable().optional(),
  new_group_name: z.string().optional(),
});

export function parseCreateConversationTitle(body: Record<string, unknown>): string {
  const parsed = CreateConversationRequestSchema.safeParse(body);
  if (!parsed.success) return "New chat";
  return typeof parsed.data.title === "string" ? parsed.data.title : "New chat";
}

export function parseUpdateConversationRequest(body: Record<string, unknown>): {
  title?: string;
  group_id?: string | null;
  new_group_name?: string;
} {
  const parsed = UpdateConversationRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : {};
}

export function toPostConversationMessageAcceptedResponse(
  conversationId: string,
): PostConversationMessageAcceptedResponse {
  return { conversation_id: conversationId };
}

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((i) => `${context}.${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
  return new Error(`${context} validation failed: ${details}`);
}

function parseChatMessageEntry(value: unknown, index: number): ChatMessageEntry {
  const parsed = ChatEntrySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    const role = rec.role;
    if (role === "user") {
      const agentId = String(rec.agentId ?? rec.agent_id ?? "").trim();
      if (!agentId) {
        throw new Error("GET /api/conversations/:id/messages validation failed: user role message missing agentId");
      }
      return {
        type: "user-message",
        id: typeof rec.id === "string" ? rec.id : "",
        text: typeof rec.text === "string" ? rec.text : "",
        agentId,
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
    if (role === "assistant") {
      return {
        type: "assistant-message",
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

export function validateGetConversationsResponse(data: unknown): GetConversationsResponse {
  const parsed = GetConversationsResponseSchema.safeParse(data);
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

export function validatePostConversationMessageResponse(data: unknown): PostConversationMessageAcceptedResponse {
  const parsed = PostConversationMessageAcceptedResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError("POST /api/conversations/:id/messages", parsed.error);
  return parsed.data;
}

export function validatePostConversationMessageRequest(data: unknown): PostConversationMessageRequest {
  const parsed = PostConversationMessageRequestSchema.safeParse(data);
  if (!parsed.success) {
    throw formatZodError("POST /api/conversations/:id/messages request", parsed.error);
  }
  return parsed.data;
}
