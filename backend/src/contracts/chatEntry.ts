import { z } from 'zod';
import { ProviderCostBreakdownSchema } from './provider-cost.js';
import { LlmRefSchema } from './llm.js';
import { RetrievalHitSchema, RetrievalQuerySchema } from './retrieval.js';
import { UserMessageOverridesSchema } from './user-message-overrides.js';
import { PreinjectedFileRecordSchema } from './preinject.js';

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
  /**
   * Side-lane entries (title/categorize/attachment-summary thoughts,
   * params-resolution and guardrail thoughts) hang off their anchor entry for
   * display but are not alternatives to it: branch walks, fork counting, and
   * the chosen path consider spine (isSide=false) children only.
   */
  isSide: z.boolean(),
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
  /** The model's few-word purpose line for this call, emitted with the call. */
  note: z.string().optional(),
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
  // The full response text, de-chunked (raw view shows the provider chunks).
  assembledResponse: z.string().optional(),
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

/**
 * The kind of framework LLM cycle a thought stream represents. This — not the
 * chat-entry `type` — is the discriminant for which provider produced a stream
 * entry. Adding a new thought is one value here + one provider, with no new
 * entry type rippling through the contract, mapper, repo, and frontend union.
 */
export const ThoughtTypeSchema = z.enum([
  'planner',
  'title',
  'tool_params',
  'summarize',
  'summarize_attachment',
  'guardrail',
  'categorize',
]);
export type ThoughtType = z.infer<typeof ThoughtTypeSchema>;

/**
 * Single chat-entry type for every thought's LLM-call trace. The specific kind
 * is carried in `thoughtType`. Per-thoughtType extras are optional and only
 * populated for their owning thoughtType:
 *  - planner: `parseResult`
 *  - summarize_attachment: `attachmentId` / `userMessageId` / `filename` /
 *    `mimeType` / `sizeBytes` / `summaryText`. The stream entry IS the
 *    persisted attachment summary (no separate output entry); `summaryText`
 *    lands on `runDecision`, the file metadata is stamped at creation for
 *    offline consumers (planner prompt, ask_attachment tool, UI).
 */
export const ThoughtStreamEntrySchema = ThoughtStreamEntryBaseSchema.extend({
  type: z.literal('thought_stream'),
  thoughtType: ThoughtTypeSchema,
  // planner
  parseResult: PlannerParseResultSchema.optional(),
  // summarize_attachment
  attachmentId: z.string().optional(),
  userMessageId: z.string().optional(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  summaryText: z.string().optional(),
});
export type ThoughtStreamEntry = z.infer<typeof ThoughtStreamEntrySchema>;

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

export const ToolStateSchema = z.enum(['resolving', 'requested', 'running', 'done', 'error', 'denied']);
export type ToolState = z.infer<typeof ToolStateSchema>;

export const ToolInvocationEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('tool-invocation'),
  toolId: z.string(),
  state: ToolStateSchema,
  parameters: z.record(z.string(), z.unknown()),
  /** The params the model originally requested, kept when the user edited
   *  them before approving. The run used `parameters`, not these. */
  originalParameters: z.record(z.string(), z.unknown()).optional(),
  /** True when the user edited parameters before approval — the transcript
   *  must make obvious that the executed call differs from the requested one. */
  parametersEdited: z.boolean().optional(),
  /** Execution attempt count (from tool_runs); ≥2 means the entry was retried.
   *  Surfaced so a near-instant retry that fails identically still visibly
   *  changes the row. */
  attempt: z.number().int().min(1).optional(),
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

/**
 * Persisted, once-per-conversation record of the pre-planner context-file
 * scan (see context-injection.service.ts). `files` lists every candidate
 * file the scan discovered on disk, each tagged with whether it was folded
 * into `content` (`injected`) or left out (`skipped` — category not
 * selected, unreadable, or binary). Appended as a thought-less spine entry
 * right after the first user-message, before the planner thought starts, so
 * `content` is already part of the immutable entry DAG the planner reads
 * from — no separate re-scan on reprocess.
 */
export const ContextInjectionEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('context-injection'),
  files: z.array(PreinjectedFileRecordSchema),
  content: z.string(),
});
export type ContextInjectionEntry = z.infer<typeof ContextInjectionEntrySchema>;

/**
 * Harness-driven context fetch, recorded on the spine right after the user
 * message it grounds (before the planner thought starts). NOT a tool
 * invocation — tool rows assert the model chose them; this retrieval was
 * forced by the user (`overrides.rag`) and executed by the harness.
 * `source` names the corpus kind: future grounding sources (attachment
 * recall, conversation memory) reuse this entry type with another source,
 * not a new entry kind. The initial insert is schema-complete with
 * state 'pending' and hits [] (the snapshot mapper must be able to serve
 * every committed state); the done/failed update only fills optionals.
 */
export const RetrievalEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('retrieval'),
  source: z.literal('rag'),
  state: z.enum(['pending', 'done', 'failed']),
  queries: z.array(RetrievalQuerySchema),
  /** Display names of the storages searched. */
  storages: z.array(z.string()),
  hits: z.array(RetrievalHitSchema),
  error: z.string().optional(),
});
export type RetrievalEntry = z.infer<typeof RetrievalEntrySchema>;

// ---- Union ----

export const ChatEntrySchema = z.discriminatedUnion('type', [
  UserMessageEntrySchema,
  ThoughtPrepareEntrySchema,
  ThoughtStreamEntrySchema,
  ThoughtActionEntrySchema,
  ToolInvocationEntrySchema,
  AssistantMessageEntrySchema,
  CheckpointSummaryEntrySchema,
  ContextInjectionEntrySchema,
  RetrievalEntrySchema,
]);
export type ChatEntry = z.infer<typeof ChatEntrySchema>;
