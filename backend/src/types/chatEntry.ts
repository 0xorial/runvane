import { z } from "zod";

type ValidationSink = { add(path: string, message: string): void };

export type LlmDecisionTool = {
  type: "tool-invocation";
  toolId: string;
  parameters: Record<string, unknown>;
};
export const LlmDecisionToolSchema = z.object({
  type: z.literal("tool-invocation"),
  toolId: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});

export type LlmDecisionUserResponse = {
  type: "user-response";
  text: string;
};
export const LlmDecisionUserResponseSchema = z.object({
  type: z.literal("user-response"),
  text: z.string(),
});

export type LlmDecision = LlmDecisionTool | LlmDecisionUserResponse;
export const LlmDecisionSchema = z.discriminatedUnion("type", [LlmDecisionToolSchema, LlmDecisionUserResponseSchema]);

export const AgenticFollowupValues = ["finalize", "continue"] as const;
export type AgenticFollowup = (typeof AgenticFollowupValues)[number];

export type AgenticToolCall = {
  toolId: string;
  parameters: Record<string, unknown>;
};
export const AgenticToolCallSchema = z.object({
  toolId: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
});

export type AgenticToolRequest = {
  tool_name: string;
  request: string;
};
export const AgenticToolRequestSchema = z.object({
  tool_name: z.string().min(1),
  request: z.string().min(1),
});

export type AgenticPlannerOutput = {
  assistant_output?: string;
  tool_calls: AgenticToolCall[];
  tool_requests: AgenticToolRequest[];
  followup: AgenticFollowup;
};
export const AgenticPlannerOutputSchema: z.ZodType<AgenticPlannerOutput> = z.object({
  assistant_output: z.string().optional(),
  tool_calls: z.array(AgenticToolCallSchema).default([]),
  tool_requests: z.array(AgenticToolRequestSchema).default([]),
  followup: z.enum(AgenticFollowupValues),
});

export type ChatEntryBase = {
  id: string;
  conversationIndex: number;
  createdAt: string;
};
export const ChatEntryBaseSchema = z.object({
  id: z.string(),
  conversationIndex: z.number().finite(),
  createdAt: z.string(),
});

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

export const ChatAttachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().finite(),
  url: z.string().min(1),
});

export function reqAttachmentTyping(value: unknown, ctx: ValidationSink, path: string): ChatAttachment | null {
  const parsed = ChatAttachmentSchema.safeParse(value);
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => {
      const suffix = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
      ctx.add(`${path}${suffix}`, issue.message);
    });
    return null;
  }
  return parsed.data;
}

export const validateAndSanitizeChatAttachmentTyping = reqAttachmentTyping;

export type UserMessageEntry = ChatEntryBase & {
  type: "user-message";
  text: string;
  agentId: string;
  llmProviderId?: string;
  llmModel?: string;
  modelPresetId?: number | null;
  attachments?: ChatAttachment[];
};
export const UserMessageEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal("user-message"),
  text: z.string(),
  agentId: z.string().min(1),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
  modelPresetId: z.number().finite().nullable().optional(),
  attachments: z.array(ChatAttachmentSchema).optional(),
});

export type UserMessageSelection = {
  agentId: string;
  llmProviderId?: string;
  llmModel?: string;
  modelPresetId?: number | null;
};
export const UserMessageSelectionSchema = z.object({
  agentId: z.string().min(1),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
  modelPresetId: z.number().finite().nullable().optional(),
});

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeUserMessageSelection(input: UserMessageSelection): UserMessageSelection {
  const agentId = String(input.agentId ?? "").trim();
  if (!agentId) {
    throw new Error("agentId is required for user message selection");
  }
  const llmProviderId = optionalString(input?.llmProviderId);
  const llmModel = optionalString(input?.llmModel);
  const modelPresetId = optionalFiniteNumber(input?.modelPresetId);
  return {
    agentId,
    ...(llmProviderId !== undefined ? { llmProviderId } : {}),
    ...(llmModel !== undefined ? { llmModel } : {}),
    ...(modelPresetId != null ? { modelPresetId } : {}),
  };
}

export function userMessageSelectionFromPayload(payload: Record<string, unknown>): UserMessageSelection {
  const agentId = String(payload.agentId ?? "").trim();
  if (!agentId) {
    throw new Error("user-message payload missing required agentId");
  }
  const llmProviderId = optionalString(payload.llmProviderId);
  const llmModel = optionalString(payload.llmModel);
  const modelPresetId = optionalFiniteNumber(payload.modelPresetId);
  return {
    agentId,
    ...(llmProviderId !== undefined ? { llmProviderId } : {}),
    ...(llmModel !== undefined ? { llmModel } : {}),
    ...(modelPresetId != null ? { modelPresetId } : {}),
  };
}

export function userMessageAttachmentsFromPayload(payload: Record<string, unknown>): ChatAttachment[] {
  const raw = payload.attachments;
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachment[] = [];
  for (const item of raw) {
    const parsed = ChatAttachmentSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** Planner / thinking row — same `type` string as SSE `planner_llm_stream`. */
export type PlannerLlmStreamEntry = ChatEntryBase & {
  type: "planner_llm_stream";
  llmRequest: string; // plain text that was sent to the LLM
  llmResponse?: string;
  thoughtMs?: number | null;
  decision?: LlmDecision | null;
  status?: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  llmModel?: string;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
};
export const PlannerLlmStreamEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal("planner_llm_stream"),
  llmRequest: z.string(),
  llmResponse: z.string().optional(),
  thoughtMs: z.number().finite().nullable().optional(),
  decision: LlmDecisionSchema.nullable().optional(),
  status: z.enum(["running", "completed", "failed", "cancelled"]).optional(),
  error: z.string().optional(),
  llmModel: z.string().optional(),
  promptTokens: z.number().finite().optional(),
  cachedPromptTokens: z.number().finite().optional(),
  completionTokens: z.number().finite().optional(),
});

export type TitleLlmStreamEntry = ChatEntryBase & {
  type: "title_llm_stream";
  llmRequest: string;
  llmResponse?: string;
  thoughtMs?: number | null;
  decision?: LlmDecision | null;
  status?: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  llmModel?: string;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
};
export const TitleLlmStreamEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal("title_llm_stream"),
  llmRequest: z.string(),
  llmResponse: z.string().optional(),
  thoughtMs: z.number().finite().nullable().optional(),
  decision: LlmDecisionSchema.nullable().optional(),
  status: z.enum(["running", "completed", "failed", "cancelled"]).optional(),
  error: z.string().optional(),
  llmModel: z.string().optional(),
  promptTokens: z.number().finite().optional(),
  cachedPromptTokens: z.number().finite().optional(),
  completionTokens: z.number().finite().optional(),
});

export type ToolInvocationEntry = ChatEntryBase & {
  type: "tool-invocation";
  toolId: string;
  state: "requested" | "running" | "done" | "error";
  parameters: Record<string, unknown>;
  result: unknown;
};
export const ToolInvocationEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal("tool-invocation"),
  toolId: z.string(),
  state: z.enum(["requested", "running", "done", "error"]),
  parameters: z.record(z.string(), z.unknown()),
  result: z.unknown(),
});

export type AssistantMessageEntry = ChatEntryBase & {
  type: "assistant-message";
  text: string;
};
export const AssistantMessageEntrySchema = ChatEntryBaseSchema.extend({
  type: z.literal("assistant-message"),
  text: z.string(),
});

export type ChatEntry =
  | UserMessageEntry
  | PlannerLlmStreamEntry
  | TitleLlmStreamEntry
  | ToolInvocationEntry
  | AssistantMessageEntry;
export const ChatEntrySchema = z.discriminatedUnion("type", [
  UserMessageEntrySchema,
  PlannerLlmStreamEntrySchema,
  TitleLlmStreamEntrySchema,
  ToolInvocationEntrySchema,
  AssistantMessageEntrySchema,
]);

export function isPlannerThinkingEntry(e: ChatEntry): e is PlannerLlmStreamEntry {
  return e.type === "planner_llm_stream";
}
