import { z } from "zod";

import type { ChatEntry } from "../types/chatEntry.js";
import { ChatEntrySchema } from "../types/chatEntry.js";

export type ConversationRow = {
  id: string;
  title: string;
  groupId: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  promptTokensTotal: number;
  cachedPromptTokensTotal: number;
  completionTokensTotal: number;
  tokenUsageByModel: Array<{
    modelName: string;
    promptTokens: number;
    cachedPromptTokens: number;
    completionTokens: number;
  }>;
};
export type ConversationGroupRow = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
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
  agentId: string;
  llmProviderId?: string;
  llmModel?: string;
  modelPresetId?: number;
  attachmentIds?: string[];
};
export type PostConversationMessageAcceptedResponse = {
  conversationId: string;
};

const ConversationRowSchema: z.ZodType<ConversationRow> = z.object({
  id: z.string(),
  title: z.string(),
  groupId: z.string().nullable(),
  isDeleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  promptTokensTotal: z.number().finite(),
  cachedPromptTokensTotal: z.number().finite(),
  completionTokensTotal: z.number().finite(),
  tokenUsageByModel: z.array(
    z.object({
      modelName: z.string(),
      promptTokens: z.number().finite(),
      cachedPromptTokens: z.number().finite(),
      completionTokens: z.number().finite(),
    }),
  ),
});
const ConversationGroupRowSchema: z.ZodType<ConversationGroupRow> = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
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
  agentId: z.string(),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
  modelPresetId: z.number().finite().optional(),
  attachmentIds: z.array(z.string()).optional(),
});
const PostConversationMessageAcceptedResponseSchema: z.ZodType<PostConversationMessageAcceptedResponse> = z.object({
  conversationId: z.string(),
});

const UpdateConversationRequestSchema = z.object({
  title: z.string().optional(),
  groupId: z.string().nullable().optional(),
  newGroupName: z.string().optional(),
});

export function parseCreateConversationTitle(body: Record<string, unknown>): string {
  const parsed = CreateConversationRequestSchema.safeParse(body);
  if (!parsed.success) return "New chat";
  return typeof parsed.data.title === "string" ? parsed.data.title : "New chat";
}

export function parseUpdateConversationRequest(body: Record<string, unknown>): {
  title?: string;
  groupId?: string | null;
  newGroupName?: string;
} {
  const parsed = UpdateConversationRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : {};
}

export function toPostConversationMessageAcceptedResponse(
  conversationId: string,
): PostConversationMessageAcceptedResponse {
  return { conversationId };
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
      const agentId = String(rec.agentId ?? "").trim();
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
