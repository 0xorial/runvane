import type { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import type { ConversationEventHub } from "../events/conversationEventHub.js";
import { SseType } from "../types/sse.js";
import { TokenUsageMapper } from "../types/tokenUsage.js";
import type {
  LlmDecision,
  PlannerLlmStreamEntry,
  ThoughtActionEntry,
  ThoughtPrepareEntry,
  TitleLlmStreamEntry,
} from "../types/chatEntry.js";

export type ThoughtStreamKind = "planner" | "title";
export type ThoughtStreamStatus = "running" | "completed" | "failed" | "cancelled";

type ThoughtUsage = {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
};

type ThoughtLifecycleDeps = {
  chatEntries: ChatEntriesRepo;
  hub: ConversationEventHub;
};

type StartedThoughtBase<TKind extends ThoughtStreamKind> = {
  kind: TKind;
  prepareEntry: ThoughtPrepareEntry;
  streamEntry: TKind extends "planner" ? PlannerLlmStreamEntry : TitleLlmStreamEntry;
};

export type StartedThought<TKind extends ThoughtStreamKind, TIncludeAction extends boolean> = StartedThoughtBase<TKind> & {
  thoughtActionEntry: TIncludeAction extends true ? ThoughtActionEntry : null;
};

type StartThoughtInput<TKind extends ThoughtStreamKind, TIncludeAction extends boolean> = {
  conversationId: string;
  parentId?: string | null;
  llmRequest: string;
  llmModel?: string;
  kind: TKind;
  includeAction: TIncludeAction;
  summary?: string;
};

export function startThoughtLifecycle<TKind extends ThoughtStreamKind>(
  deps: ThoughtLifecycleDeps,
  input: StartThoughtInput<TKind, true>,
): StartedThought<TKind, true>;
export function startThoughtLifecycle<TKind extends ThoughtStreamKind>(
  deps: ThoughtLifecycleDeps,
  input: StartThoughtInput<TKind, false>,
): StartedThought<TKind, false>;
export function startThoughtLifecycle<TKind extends ThoughtStreamKind, TIncludeAction extends boolean>(
  deps: ThoughtLifecycleDeps,
  input: StartThoughtInput<TKind, TIncludeAction>,
): StartedThought<TKind, TIncludeAction> {
  const createdAt = new Date().toISOString();
  const thoughtId = crypto.randomUUID();
  const summary = typeof input.summary === "string" && input.summary.trim() ? input.summary.trim() : undefined;
  const prepareEntry = deps.chatEntries.appendThoughtPrepareEntry(input.conversationId, {
    id: crypto.randomUUID(),
    thoughtId,
    createdAt,
    parentId: input.parentId,
    ...(summary ? { title: summary } : {}),
    requestText: input.llmRequest,
    llmModel: input.llmModel,
  });
  deps.hub.publish(input.conversationId, {
    type: SseType.CHAT_ENTRY_UPSERT,
    entry: prepareEntry,
  });

  const streamEntry =
    input.kind === "planner"
      ? deps.chatEntries.appendPlannerLlmStreamEntry(input.conversationId, {
          id: crypto.randomUUID(),
          thoughtId,
          createdAt,
          parentId: prepareEntry.id,
          llmRequest: input.llmRequest,
          llmResponse: "",
          thoughtMs: null,
          decision: null,
          status: "running",
          llmModel: input.llmModel,
        })
      : deps.chatEntries.appendTitleLlmStreamEntry(input.conversationId, {
          id: crypto.randomUUID(),
          thoughtId,
          createdAt,
          parentId: prepareEntry.id,
          llmRequest: input.llmRequest,
          llmResponse: "",
          thoughtMs: null,
          decision: null,
          status: "running",
          llmModel: input.llmModel,
        });
  deps.hub.publish(input.conversationId, {
    type: input.kind === "planner" ? SseType.PLANNER_STARTING : SseType.TITLE_STARTING,
    chatEntryId: streamEntry.id,
    thoughtId: streamEntry.thoughtId,
    conversationIndex: streamEntry.conversationIndex,
    createdAt: streamEntry.createdAt,
    requestText: streamEntry.llmRequest,
    llmModel: streamEntry.llmModel,
  });

  let thoughtActionEntry: ThoughtActionEntry | null = null;
  if (input.includeAction) {
    thoughtActionEntry = deps.chatEntries.appendThoughtActionEntry(input.conversationId, {
      id: crypto.randomUUID(),
      thoughtId,
      createdAt,
      parentId: streamEntry.id,
      status: "running",
      summary: summary ?? "Waiting for LLM output",
    });
    deps.hub.publish(input.conversationId, {
      type: SseType.CHAT_ENTRY_UPSERT,
      entry: thoughtActionEntry,
    });
  }

  return {
    kind: input.kind,
    prepareEntry,
    streamEntry: streamEntry as StartedThought<TKind, TIncludeAction>["streamEntry"],
    thoughtActionEntry: thoughtActionEntry as StartedThought<TKind, TIncludeAction>["thoughtActionEntry"],
  };
}

export function publishThoughtLlmDelta(
  deps: ThoughtLifecycleDeps,
  input: {
    conversationId: string;
    kind: ThoughtStreamKind;
    streamEntryId: string;
    delta: string;
  },
): void {
  if (!input.delta) return;
  deps.hub.publish(input.conversationId, {
    type: input.kind === "planner" ? SseType.PLANNER_LLM_STREAM : SseType.TITLE_LLM_STREAM,
    chatEntryId: input.streamEntryId,
    delta: input.delta,
  });
}

export function updateThoughtActionEntryAndPublish(
  deps: ThoughtLifecycleDeps,
  input: {
    conversationId: string;
    id: string;
    status: ThoughtActionEntry["status"];
    summary?: string;
    action?: string;
    toolName?: string;
    error?: string;
    parseResult?: ThoughtActionEntry["parseResult"];
  },
): void {
  deps.chatEntries.updateThoughtActionEntry(input.conversationId, {
    id: input.id,
    status: input.status,
    summary: input.summary,
    action: input.action,
    toolName: input.toolName,
    error: input.error,
    parseResult: input.parseResult,
  });
  const updated = deps.chatEntries.getMessage(input.conversationId, input.id);
  if (!updated) return;
  deps.hub.publish(input.conversationId, {
    type: SseType.CHAT_ENTRY_UPSERT,
    entry: updated,
  });
}

export function finishThoughtLifecycle(
  deps: ThoughtLifecycleDeps,
  input: {
    conversationId: string;
    kind: ThoughtStreamKind;
    streamEntryId: string;
    thoughtActionEntryId?: string | null;
    llmRequest: string;
    llmResponse: string;
    thoughtMs: number;
    decision?: LlmDecision | null;
    status: ThoughtStreamStatus;
    error?: string;
    llmModel?: string;
    usage?: ThoughtUsage;
    summary: string;
    action: string;
    toolName?: string;
    parseResult?: ThoughtActionEntry["parseResult"] | PlannerLlmStreamEntry["parseResult"];
  },
): void {
  if (input.kind === "planner") {
    deps.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
      id: input.streamEntryId,
      llmRequest: input.llmRequest,
      llmResponse: input.llmResponse,
      thoughtMs: input.thoughtMs,
      decision: input.decision ?? null,
      status: input.status,
      error: input.error,
      llmModel: input.llmModel,
      ...(isPlannerParseResult(input.parseResult) ? { parseResult: input.parseResult } : {}),
      ...TokenUsageMapper.toEntryFields(input.usage),
    });
  } else {
    deps.chatEntries.updateTitleLlmStreamEntry(input.conversationId, {
      id: input.streamEntryId,
      llmRequest: input.llmRequest,
      llmResponse: input.llmResponse,
      thoughtMs: input.thoughtMs,
      decision: input.decision ?? null,
      status: input.status,
      error: input.error,
      llmModel: input.llmModel,
      ...TokenUsageMapper.toEntryFields(input.usage),
    });
  }

  deps.hub.publish(input.conversationId, {
    type: input.kind === "planner" ? SseType.PLANNER_RESPONSE : SseType.TITLE_RESPONSE,
    chatEntryId: input.streamEntryId,
    summary: input.summary,
    finished: true,
    action: input.action,
    ...(input.toolName ? { toolName: input.toolName } : {}),
    llmModel: input.llmModel,
    ...TokenUsageMapper.toSseFields(input.usage),
  });

  if (input.thoughtActionEntryId) {
    updateThoughtActionEntryAndPublish(deps, {
      conversationId: input.conversationId,
      id: input.thoughtActionEntryId,
      status: input.status,
      summary: input.summary,
      action: input.action,
      ...(input.toolName ? { toolName: input.toolName } : {}),
      ...(input.error ? { error: input.error } : {}),
      ...(isThoughtActionParseResult(input.parseResult) ? { parseResult: input.parseResult } : {}),
    });
  }
}

function isPlannerParseResult(value: unknown): value is PlannerLlmStreamEntry["parseResult"] {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  if (status === "error") return typeof (value as { error?: unknown }).error === "string";
  if (status === "ok") return true;
  return false;
}

function isThoughtActionParseResult(value: unknown): value is ThoughtActionEntry["parseResult"] {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  if (status === "error") return typeof (value as { error?: unknown }).error === "string";
  if (status === "ok") return true;
  return false;
}
