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

/**
 * The kind of framework LLM cycle a thought represents. This — not the
 * chat-entry `type` — is the discriminant for which provider produced a
 * thought entry. Adding a new thought is one value here + one provider, with
 * no new entry type rippling through the contract, mapper, repo, and frontend
 * union.
 */
export const ThoughtTypeSchema = z.enum([
  'planner',
  'title',
  'tool_params',
  'summarize',
  'summarize_attachment',
  'guardrail',
  'categorize',
  'rag_planning',
]);
export type ThoughtType = z.infer<typeof ThoughtTypeSchema>;

/**
 * Deepest pipeline stage this thought has STARTED. The pipeline is strictly
 * sequential (prepare → reason → decide), so one stage + one `status` express
 * every state the old per-step rows could: a completed prepare is
 * `stage: 'reason'` (still running); only the finished decision — or a
 * failure/cancel, wherever it struck — flips `status`.
 */
export const ThoughtStageSchema = z.enum(['prepare', 'reason', 'decide']);
export type ThoughtStage = z.infer<typeof ThoughtStageSchema>;

/**
 * Which part of the source thought a reprocess fork changed.
 * `context` — the prepared request was edited (or re-run on another model);
 * reason + decision ran fresh. `reason` — the request was kept verbatim and
 * the LLM response was replaced; only the decision ran.
 */
export const ThoughtForkPointSchema = z.enum(['context', 'reason']);
export type ThoughtForkPoint = z.infer<typeof ThoughtForkPointSchema>;

/**
 * One entry per thought: the prepared request, the streamed LLM cycle, and
 * the decision live on a single row, filled in by payload merges as the
 * stages run. A crashed thought is a row whose `stage` names where it died.
 *
 * Reprocess forks are sibling thoughts: `forkOf` points at the source thought
 * and `forkPoint` records which part changed. The request is copied at fork
 * time (never referenced), so "same prepared input" holds by immutability.
 *
 * Per-thoughtType extras are optional and only populated for their owner:
 *  - planner: `parseResult` / `decision`
 *  - summarize_attachment: `attachmentId` / `userMessageId` / `filename` /
 *    `mimeType` / `sizeBytes` / `summaryText`. The thought entry IS the
 *    persisted attachment summary (no separate output entry); `summaryText`
 *    lands on `runDecision`, the file metadata is stamped at creation for
 *    offline consumers (planner prompt, ask_attachment tool, UI).
 */
export const ThoughtEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('thought'),
  thoughtType: ThoughtTypeSchema,
  stage: ThoughtStageSchema,
  status: ThoughtStepStatusSchema,
  error: z.string().optional(),
  title: z.string().optional(),
  llm: LlmRefSchema.optional(),
  /**
   * Server-only lean reprocess pointer (JSON). Rebuilt from the immutable
   * entry DAG on reprocess — never returned on GET /messages or SSE.
   */
  inputJson: z.string().optional(),
  // Fork metadata (reprocess siblings only).
  forkOf: z.string().optional(),
  forkPoint: ThoughtForkPointSchema.optional(),
  // Prepare output: the display/edit surface — exactly what hits the wire.
  llmRequest: z.string().optional(),
  // Reason outputs.
  llmResponse: z.string().optional(),
  // The full response text, de-chunked (raw view shows the provider chunks).
  assembledResponse: z.string().optional(),
  thinkingText: z.string().optional(),
  thoughtMs: z.number().nullable().optional(),
  promptTokens: z.number().optional(),
  cachedPromptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  provider_cost: z.number().optional(),
  provider_cost_breakdown: ProviderCostBreakdownSchema.optional(),
  // Decision outputs.
  decision: LlmDecisionSchema.nullable().optional(),
  parseResult: PlannerParseResultSchema.optional(),
  summary: z.string().optional(),
  action: z.string().optional(),
  toolName: z.string().optional(),
  // summarize_attachment
  attachmentId: z.string().optional(),
  userMessageId: z.string().optional(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  summaryText: z.string().optional(),
});
export type ThoughtEntry = z.infer<typeof ThoughtEntrySchema>;

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
 * A harness-driven CONTEXT INJECTION: extra context folded onto the spine right
 * after the user message it grounds, before the planner thought starts — so it
 * is part of the immutable entry DAG the planner reads from (no re-scan/
 * re-retrieve on reprocess). One entry family, discriminated by `source`:
 *
 * - `files` — the pre-planner context-file scan (see context-injection.service).
 *   `files` lists every candidate discovered on disk, each tagged `injected`
 *   (folded into `content`) or `skipped` (category not selected, unreadable, or
 *   binary). Once-written, never updated.
 * - `rag` — a user-forced retrieval over knowledge storages (`overrides.rag`),
 *   executed by the harness (NOT a tool invocation — tool rows assert the model
 *   chose them). Starts `pending` with `hits: []` (every committed state must be
 *   snapshot-mappable); the done/failed update only fills optionals. `storages`
 *   holds display names.
 *
 * Source-specific fields are optional here; the mapper enforces the exact shape
 * per `source`. Future grounding kinds (attachment recall, conversation memory)
 * add another `source`, not a new entry type.
 */
export const ContextInjectionSourceSchema = z.enum(['files', 'rag']);
export type ContextInjectionSource = z.infer<typeof ContextInjectionSourceSchema>;

export const ContextInjectionEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal('context-injection'),
  source: ContextInjectionSourceSchema,
  // source: 'files'
  files: z.array(PreinjectedFileRecordSchema).optional(),
  content: z.string().optional(),
  // source: 'rag'
  state: z.enum(['pending', 'done', 'failed']).optional(),
  queries: z.array(RetrievalQuerySchema).optional(),
  storages: z.array(z.string()).optional(),
  hits: z.array(RetrievalHitSchema).optional(),
  error: z.string().optional(),
});
export type ContextInjectionEntry = z.infer<typeof ContextInjectionEntrySchema>;

/** The `source: 'rag'` variant, kept as a named type for retrieval call sites. */
export type RetrievalEntry = ContextInjectionEntry & { source: 'rag' };

// ---- Union ----

export const ChatEntrySchema = z.discriminatedUnion('type', [
  UserMessageEntrySchema,
  ThoughtEntrySchema,
  ToolInvocationEntrySchema,
  AssistantMessageEntrySchema,
  CheckpointSummaryEntrySchema,
  ContextInjectionEntrySchema,
]);
export type ChatEntry = z.infer<typeof ChatEntrySchema>;
