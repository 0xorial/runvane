import { z } from 'zod';

import type { ChatEntry } from './chatEntry.js';

// Re-export ChatEntry as ChatMessageEntry for frontend compatibility
export type ChatMessageEntry = ChatEntry;

export type ConversationRow = {
  id: string;
  title: string;
  groupId: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
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

export type SetConversationActiveLeafRequest = {
  entryId: string;
};

// ---- Zod schemas ----

const ChatAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  url: z.string(),
});

const ChatEntryBaseSchema = z.object({
  id: z.string(),
  conversationIndex: z.number(),
  createdAt: z.string(),
  parentId: z.string().nullable(),
});

const ThoughtStepStatusSchema = z.union([
  z.literal('running'),
  z.literal('completed'),
  z.literal('failed'),
  z.literal('cancelled'),
]);

const ThoughtStreamEntryShapeSchema = z.object({
  thoughtId: z.string(),
  llmRequest: z.string(),
  llmProviderId: z.string().optional(),
  llmResponse: z.string().optional(),
  thinkingText: z.string().optional(),
  thoughtMs: z.number().nullable().optional(),
  decision: z
    .union([
      z.object({ type: z.literal('tool-invocation'), toolId: z.string(), parameters: z.record(z.string(), z.unknown()) }),
      z.object({ type: z.literal('user-response'), text: z.string() }),
    ])
    .nullable()
    .optional(),
  status: ThoughtStepStatusSchema.optional(),
  error: z.string().optional(),
  llmModel: z.string().optional(),
  promptTokens: z.number().optional(),
  cachedPromptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
});

const AgenticToolCallSchema = z.object({
  toolId: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});

const AgenticToolRequestSchema = z.object({
  tool_name: z.string(),
  request: z.string(),
});

const AgenticPlannerOutputSchema = z.object({
  assistant_output: z.string().optional(),
  tool_calls: z.array(AgenticToolCallSchema),
  tool_requests: z.array(AgenticToolRequestSchema),
  followup: z.union([z.literal('finalize'), z.literal('continue')]),
});

const ParseResultSchema = z.union([
  z.object({ status: z.literal('ok'), parsed: AgenticPlannerOutputSchema }),
  z.object({ status: z.literal('error'), error: z.string() }),
]);

export const ChatEntrySchema: z.ZodType<ChatEntry> = z.union([
  // user-message
  ChatEntryBaseSchema.extend({
    type: z.literal('user-message'),
    text: z.string(),
    agentId: z.string(),
    llmProviderId: z.string().optional(),
    llmModel: z.string().optional(),
    modelPresetId: z.number().nullable().optional(),
    attachments: z.array(ChatAttachmentSchema).optional(),
  }),
  // thought-prepare
  ChatEntryBaseSchema.extend({
    type: z.literal('thought-prepare'),
    thoughtId: z.string(),
    status: ThoughtStepStatusSchema.optional(),
    error: z.string().optional(),
    requestText: z.string().optional(),
    title: z.string().optional(),
    llmProviderId: z.string().optional(),
    llmModel: z.string().optional(),
  }),
  // planner_llm_stream
  ChatEntryBaseSchema.merge(ThoughtStreamEntryShapeSchema).extend({
    type: z.literal('planner_llm_stream'),
    parseResult: ParseResultSchema.optional(),
  }),
  // thought-action
  ChatEntryBaseSchema.extend({
    type: z.literal('thought-action'),
    thoughtId: z.string(),
    status: ThoughtStepStatusSchema,
    summary: z.string().optional(),
    action: z.string().optional(),
    toolName: z.string().optional(),
    error: z.string().optional(),
    parseResult: ParseResultSchema.optional(),
  }),
  // title_llm_stream
  ChatEntryBaseSchema.merge(ThoughtStreamEntryShapeSchema).extend({
    type: z.literal('title_llm_stream'),
  }),
  // tool_params_llm_stream
  ChatEntryBaseSchema.merge(ThoughtStreamEntryShapeSchema).extend({
    type: z.literal('tool_params_llm_stream'),
  }),
  // summarize_llm_stream
  ChatEntryBaseSchema.merge(ThoughtStreamEntryShapeSchema).extend({
    type: z.literal('summarize_llm_stream'),
  }),
  // tool-invocation
  ChatEntryBaseSchema.extend({
    type: z.literal('tool-invocation'),
    toolId: z.string(),
    state: z.union([z.literal('requested'), z.literal('running'), z.literal('done'), z.literal('error')]),
    parameters: z.record(z.string(), z.unknown()),
    result: z.unknown(),
  }),
  // assistant-message
  ChatEntryBaseSchema.extend({
    type: z.literal('assistant-message'),
    text: z.string(),
  }),
  // checkpoint-summary
  ChatEntryBaseSchema.extend({
    type: z.literal('checkpoint-summary'),
    summarizedRange: z.object({ fromEntryId: z.string(), toEntryId: z.string() }),
    summaryText: z.string(),
  }),
]) as z.ZodType<ChatEntry>;

const ConversationRowSchema: z.ZodType<ConversationRow> = z.object({
  id: z.string(),
  title: z.string(),
  groupId: z.string().nullable(),
  isDeleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string(),
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

const PostConversationMessageAcceptedResponseSchema: z.ZodType<PostConversationMessageAcceptedResponse> = z.object({
  conversationId: z.string(),
});

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((i) => `${context}.${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
  return new Error(`${context} validation failed: ${details}`);
}

function parseChatMessageEntry(value: unknown, index: number): ChatMessageEntry {
  const parsed = ChatEntrySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    const role = rec.role;
    if (role === 'user') {
      const agentId = String(rec.agentId ?? '').trim();
      if (!agentId) {
        throw new Error('GET /api/conversations/:id/messages validation failed: user role message missing agentId');
      }
      return {
        type: 'user-message',
        id: typeof rec.id === 'string' ? rec.id : '',
        text: typeof rec.text === 'string' ? rec.text : '',
        parentId: typeof rec.parentId === 'string' ? rec.parentId : null,
        agentId,
        conversationIndex:
          typeof rec.conversationIndex === 'number' && Number.isFinite(rec.conversationIndex)
            ? rec.conversationIndex
            : index,
        createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
      };
    }
    if (role === 'assistant') {
      return {
        type: 'assistant-message',
        id: typeof rec.id === 'string' ? rec.id : '',
        text: typeof rec.text === 'string' ? rec.text : '',
        parentId: typeof rec.parentId === 'string' ? rec.parentId : null,
        conversationIndex:
          typeof rec.conversationIndex === 'number' && Number.isFinite(rec.conversationIndex)
            ? rec.conversationIndex
            : index,
        createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
      };
    }
  }
  throw formatZodError('GET /api/conversations/:id/messages', parsed.error);
}

export function validateConversationRowResponse(value: unknown, context: string): ConversationRow {
  const parsed = ConversationRowSchema.safeParse(value);
  if (!parsed.success) throw formatZodError(context, parsed.error);
  return parsed.data;
}

export function validateGetConversationsResponse(data: unknown): GetConversationsResponse {
  const parsed = GetConversationsResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('GET /api/conversations', parsed.error);
  return parsed.data;
}

export function validatePostConversationsResponse(data: unknown): ConversationRow {
  return validateConversationRowResponse(data, 'POST /api/conversations');
}

export function validateGetConversationMessagesResponse(data: unknown): ChatMessageEntry[] {
  const arr = z.array(z.unknown()).safeParse(data);
  if (!arr.success) throw formatZodError('GET /api/conversations/:id/messages', arr.error);
  return arr.data.map((row, i) => parseChatMessageEntry(row, i));
}

export function validatePostConversationMessageResponse(data: unknown): PostConversationMessageAcceptedResponse {
  const parsed = PostConversationMessageAcceptedResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('POST /api/conversations/:id/messages', parsed.error);
  return parsed.data;
}
