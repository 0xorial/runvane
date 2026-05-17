import { z } from 'zod';

// ---- Primitives ----

export const ChatAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  url: z.string(),
});
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const ChatEntryBaseSchema = z.object({
  id: z.string(),
  conversationIndex: z.number(),
  createdAt: z.string(),
  parentId: z.string().nullable(),
});
export type ChatEntryBase = z.infer<typeof ChatEntryBaseSchema>;

export const ThoughtStepStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled']);
export type ThoughtStepStatus = z.infer<typeof ThoughtStepStatusSchema>;

// ---- Agentic planner types ----

export const AgenticToolCallSchema = z.object({
  toolId: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});
export type AgenticToolCall = z.infer<typeof AgenticToolCallSchema>;

export const AgenticToolRequestSchema = z.object({
  tool_name: z.string(),
  request: z.string(),
});
export type AgenticToolRequest = z.infer<typeof AgenticToolRequestSchema>;

export const AgenticPlannerOutputSchema = z.object({
  assistant_output: z.string().optional(),
  tool_calls: z.array(AgenticToolCallSchema),
  tool_requests: z.array(AgenticToolRequestSchema),
  followup: z.enum(['finalize', 'continue']),
});
export type AgenticPlannerOutput = z.infer<typeof AgenticPlannerOutputSchema>;

export const LlmDecisionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('tool-invocation'),
    toolId: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('user-response'), text: z.string() }),
]);
export type LlmDecision = z.infer<typeof LlmDecisionSchema>;
export type LlmDecisionTool = Extract<LlmDecision, { type: 'tool-invocation' }>;
export type LlmDecisionUserResponse = Extract<LlmDecision, { type: 'user-response' }>;

export const PlannerParseResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), parsed: AgenticPlannerOutputSchema }),
  z.object({ status: z.literal('error'), error: z.string() }),
]);
export type PlannerParseResult = z.infer<typeof PlannerParseResultSchema>;

// ---- Entry schemas ----

export const UserMessageEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('user-message'),
  text: z.string(),
  agentId: z.string(),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
  modelPresetId: z.number().nullable().optional(),
  attachments: z.array(ChatAttachmentSchema).optional(),
});
export type UserMessageEntry = z.infer<typeof UserMessageEntrySchema>;

export const ThoughtPrepareEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('thought-prepare'),
  thoughtId: z.string(),
  status: ThoughtStepStatusSchema.optional(),
  error: z.string().optional(),
  requestText: z.string().optional(),
  title: z.string().optional(),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
});
export type ThoughtPrepareEntry = z.infer<typeof ThoughtPrepareEntrySchema>;

const ThoughtStreamEntryBaseSchema = ChatEntryBaseSchema.extend({
  thoughtId: z.string(),
  llmRequest: z.string(),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
  llmResponse: z.string().optional(),
  thinkingText: z.string().optional(),
  thoughtMs: z.number().nullable().optional(),
  decision: LlmDecisionSchema.nullable().optional(),
  status: ThoughtStepStatusSchema.optional(),
  error: z.string().optional(),
  promptTokens: z.number().optional(),
  cachedPromptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
});

export const PlannerLlmStreamEntrySchema = ThoughtStreamEntryBaseSchema.extend({
  type: z.literal('planner_llm_stream'),
  parseResult: PlannerParseResultSchema.optional(),
});
export type PlannerLlmStreamEntry = z.infer<typeof PlannerLlmStreamEntrySchema>;

export const TitleLlmStreamEntrySchema = ThoughtStreamEntryBaseSchema.extend({
  type: z.literal('title_llm_stream'),
});
export type TitleLlmStreamEntry = z.infer<typeof TitleLlmStreamEntrySchema>;

export const ToolParamsLlmStreamEntrySchema = ThoughtStreamEntryBaseSchema.extend({
  type: z.literal('tool_params_llm_stream'),
});
export type ToolParamsLlmStreamEntry = z.infer<typeof ToolParamsLlmStreamEntrySchema>;

export const SummarizeLlmStreamEntrySchema = ThoughtStreamEntryBaseSchema.extend({
  type: z.literal('summarize_llm_stream'),
});
export type SummarizeLlmStreamEntry = z.infer<typeof SummarizeLlmStreamEntrySchema>;

export const ThoughtActionEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('thought-action'),
  thoughtId: z.string(),
  status: ThoughtStepStatusSchema,
  summary: z.string().optional(),
  action: z.string().optional(),
  toolName: z.string().optional(),
  error: z.string().optional(),
  parseResult: PlannerParseResultSchema.optional(),
});
export type ThoughtActionEntry = z.infer<typeof ThoughtActionEntrySchema>;

export const ToolInvocationEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('tool-invocation'),
  toolId: z.string(),
  state: z.enum(['requested', 'running', 'done', 'error']),
  parameters: z.record(z.string(), z.unknown()),
  result: z.unknown(),
});
export type ToolInvocationEntry = z.infer<typeof ToolInvocationEntrySchema>;

export const AssistantMessageEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('assistant-message'),
  text: z.string(),
});
export type AssistantMessageEntry = z.infer<typeof AssistantMessageEntrySchema>;

export const CheckpointSummaryEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('checkpoint-summary'),
  summarizedRange: z.object({ fromEntryId: z.string(), toEntryId: z.string() }),
  summaryText: z.string(),
  rangeEntryCount: z.number().optional(),
  /** Total input tokens (prompt + cached) consumed by the summarize LLM call — context size before folding. */
  rangeInputTokens: z.number().optional(),
  /** Completion tokens from the summarize LLM call — token size of the summary text itself. */
  summaryTokens: z.number().optional(),
});
export type CheckpointSummaryEntry = z.infer<typeof CheckpointSummaryEntrySchema>;

// ---- Union ----

export const ChatEntrySchema = z.discriminatedUnion('type', [
  UserMessageEntrySchema,
  ThoughtPrepareEntrySchema,
  PlannerLlmStreamEntrySchema,
  TitleLlmStreamEntrySchema,
  ToolParamsLlmStreamEntrySchema,
  SummarizeLlmStreamEntrySchema,
  ThoughtActionEntrySchema,
  ToolInvocationEntrySchema,
  AssistantMessageEntrySchema,
  CheckpointSummaryEntrySchema,
]);
export type ChatEntry = z.infer<typeof ChatEntrySchema>;
