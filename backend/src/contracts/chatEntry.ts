import { z } from 'zod';
import { ProviderCostBreakdownSchema } from './provider-cost.js';
import { LlmRefSchema } from './llm.js';
import { UserMessageOverridesSchema } from './user-message-overrides.js';

// ---- Primitives ----

/**
 * How the attachment is delivered to downstream LLM calls.
 *
 * - `direct`: raw bytes are inlined into the user message at reason time
 *   (image / file part). Burns tokens but the model sees ground truth.
 * - `summary`: a one-shot summarize-attachment thought runs before the
 *   planner. The planner sees the summary text in place of the raw bytes,
 *   and can call the `ask_attachment` tool to query the full content via
 *   a RAG-style subagent. Cheap on tokens; relies on summary quality + tool
 *   usage for precise lookups.
 */
export const AttachmentModeSchema = z.enum(['direct', 'summary']);
export type AttachmentMode = z.infer<typeof AttachmentModeSchema>;

export const ChatAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  url: z.string(),
  mode: AttachmentModeSchema,
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
  llm: LlmRefSchema.optional(),
  modelPresetId: z.number().nullable().optional(),
  attachments: z.array(ChatAttachmentSchema).optional(),
  overrides: UserMessageOverridesSchema.optional(),
});
export type UserMessageEntry = z.infer<typeof UserMessageEntrySchema>;

export const ThoughtPrepareEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('thought-prepare'),
  thoughtId: z.string(),
  status: ThoughtStepStatusSchema.optional(),
  error: z.string().optional(),
  requestText: z.string().optional(),
  title: z.string().optional(),
  llm: LlmRefSchema.optional(),
  /**
   * Server-only lean reprocess pointer (JSON). Rebuilt from the immutable
   * entry DAG on reprocess — never returned on GET /messages or SSE.
   */
  inputJson: z.string().optional(),
});
export type ThoughtPrepareEntry = z.infer<typeof ThoughtPrepareEntrySchema>;

const ThoughtStreamEntryBaseSchema = ChatEntryBaseSchema.extend({
  thoughtId: z.string(),
  llmRequest: z.string(),
  llm: LlmRefSchema.optional(),
  llmResponse: z.string().optional(),
  thinkingText: z.string().optional(),
  thoughtMs: z.number().nullable().optional(),
  decision: LlmDecisionSchema.nullable().optional(),
  status: ThoughtStepStatusSchema.optional(),
  error: z.string().optional(),
  promptTokens: z.number().optional(),
  cachedPromptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  provider_cost: z.number().optional(),
  provider_cost_breakdown: ProviderCostBreakdownSchema.optional(),
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

/**
 * Carries both the LLM-call trace and the produced summary text. There is no
 * separate "attachment-summary" output entry: the stream entry IS the
 * persisted output. `summaryText` lands on completion of `runDecision`;
 * `filename` / `mimeType` / `sizeBytes` are stamped at stream-entry
 * creation for offline consumers (planner prompt, ask_attachment tool, UI).
 */
export const SummarizeAttachmentLlmStreamEntrySchema = ThoughtStreamEntryBaseSchema.extend({
  type: z.literal('summarize_attachment_llm_stream'),
  attachmentId: z.string(),
  /**
   * Id of the user-message this summary was triggered by. Used to scope
   * the "all peers settled?" check to a single batch when starting the
   * planner.
   */
  userMessageId: z.string(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  summaryText: z.string().optional(),
});
export type SummarizeAttachmentLlmStreamEntry = z.infer<typeof SummarizeAttachmentLlmStreamEntrySchema>;

export const GuardrailLlmStreamEntrySchema = ThoughtStreamEntryBaseSchema.extend({
  type: z.literal('guardrail_llm_stream'),
});
export type GuardrailLlmStreamEntry = z.infer<typeof GuardrailLlmStreamEntrySchema>;

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

export const ToolPermissionSchema = z.enum(['allow', 'ask_user', 'forbid']);
export type ToolPermission = z.infer<typeof ToolPermissionSchema>;

export const ToolEnvelopeSchema = z.object({
  ok: z.boolean(),
  toolId: z.string(),
  output: z.unknown(),
  error: z.string().nullable(),
  permission_state: ToolPermissionSchema,
  timing: z.object({
    started_at: z.string(),
    finished_at: z.string(),
    elapsed_ms: z.number(),
  }),
});
export type ToolEnvelope = z.infer<typeof ToolEnvelopeSchema>;

export const ToolStateSchema = z.enum(['requested', 'running', 'done', 'error', 'denied']);
export type ToolState = z.infer<typeof ToolStateSchema>;

export const ToolInvocationEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('tool-invocation'),
  toolId: z.string(),
  state: ToolStateSchema,
  parameters: z.record(z.string(), z.unknown()),
  result: ToolEnvelopeSchema.nullable().optional(),
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
  SummarizeAttachmentLlmStreamEntrySchema,
  GuardrailLlmStreamEntrySchema,
  ThoughtActionEntrySchema,
  ToolInvocationEntrySchema,
  AssistantMessageEntrySchema,
  CheckpointSummaryEntrySchema,
]);
export type ChatEntry = z.infer<typeof ChatEntrySchema>;
