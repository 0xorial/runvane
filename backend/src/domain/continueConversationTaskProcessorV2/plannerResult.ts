import { SseType } from "../../types/sse.js";
import { TokenUsageMapper } from "../../types/tokenUsage.js";
import type { AgenticToolRequest } from "../../types/chatEntry.js";
import type {
  ContinueConversationProcessorDeps,
  FinalizePlannerResultInput,
  FinalizePlannerResultOutput,
} from "./types.js";
import { agentToolConfigFor, publishConversationUpdated } from "./context.js";

export function parseRequestedToolCalls(input: {
  requests: AgenticToolRequest[];
  enabledToolIds: string[];
}): Array<{ toolName: string; toolRequest: string }> {
  if (input.requests.length === 0) return [];
  const out: Array<{ toolName: string; toolRequest: string }> = [];
  const allowedTools = new Set(input.enabledToolIds);
  for (const request of input.requests) {
    const toolName = String(request.tool_name ?? "").trim();
    const toolRequest = String(request.request ?? "").trim();
    if (!toolName || !toolRequest) continue;
    if (!allowedTools.has(toolName)) {
      throw new Error(`tool request references disabled or unknown tool: ${toolName}`);
    }
    out.push({ toolName, toolRequest });
  }
  return out;
}

export function persistPlannerParseFailure(
  deps: ContinueConversationProcessorDeps,
  input: {
    conversationId: string;
    plannerEntryId: string;
    llmRequest: string;
    llmResponse: string;
    plannerLlmModel?: string;
    requestStartedMs: number;
    detail: string;
    plannerTokenUsage?: { promptTokens: number; completionTokens: number; cachedPromptTokens?: number };
  },
): void {
  deps.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
    id: input.plannerEntryId,
    llmRequest: input.llmRequest,
    llmResponse: input.llmResponse,
    thoughtMs: Math.max(0, Date.now() - input.requestStartedMs),
    decision: null,
    status: "failed",
    error: input.detail,
    llmModel: input.plannerLlmModel,
    parseResult: {
      status: "error",
      error: input.detail,
    },
    ...TokenUsageMapper.toEntryFields(input.plannerTokenUsage),
  });
  publishConversationUpdated(deps, input.conversationId);
  deps.hub.publish(input.conversationId, {
    type: SseType.PLANNER_RESPONSE,
    chatEntryId: input.plannerEntryId,
    summary: input.detail,
    finished: true,
    action: "failed",
    llmModel: input.plannerLlmModel,
    ...TokenUsageMapper.toSseFields(input.plannerTokenUsage),
  });
}

export function upsertAssistantMessageFromPlanner(
  deps: ContinueConversationProcessorDeps,
  input: {
    conversationId: string;
    assistantText: string;
    assistantEntryId?: string | null;
  },
): void {
  if (!input.assistantText) return;
  if (input.assistantEntryId) {
    deps.chatEntries.updateAssistantMessage(input.conversationId, {
      id: input.assistantEntryId,
      text: input.assistantText,
    });
    return;
  }
  const assistantEntry = deps.chatEntries.appendAssistantMessage(input.conversationId, input.assistantText);
  deps.hub.publish(input.conversationId, {
    type: SseType.ASSISTANT_STREAM,
    chatEntryId: assistantEntry.id,
    delta: input.assistantText,
  });
}

export function finalizeParsedPlannerResult(
  deps: ContinueConversationProcessorDeps,
  input: FinalizePlannerResultInput,
): FinalizePlannerResultOutput {
  const decision = input.parsedLlmResponse.decision;
  const agentic = input.parsedLlmResponse.output;
  const requestedToolCalls = parseRequestedToolCalls({
    requests: agentic.tool_requests,
    enabledToolIds: input.enabledToolIds,
  });

  deps.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
    id: input.plannerEntryId,
    llmRequest: input.llmRequest,
    llmResponse: input.llmResponse,
    thoughtMs: Math.max(0, Date.now() - input.requestStartedMs),
    decision,
    status: "completed",
    llmModel: input.plannerLlmModel,
    parseResult: {
      status: "ok",
      parsed: agentic,
    },
    ...TokenUsageMapper.toEntryFields(input.plannerTokenUsage),
  });

  const assistantText = String(agentic.assistant_output ?? "").trim();
  upsertAssistantMessageFromPlanner(deps, {
    conversationId: input.conversationId,
    assistantText,
    assistantEntryId: input.assistantEntryId,
  });

  publishConversationUpdated(deps, input.conversationId);
  deps.hub.publish(input.conversationId, {
    type: SseType.PLANNER_RESPONSE,
    chatEntryId: input.plannerEntryId,
    summary:
      requestedToolCalls.length > 0 ? `Queued ${requestedToolCalls.length} tool call(s)` : assistantText || input.completionSummaryFallback,
    finished: true,
    action: requestedToolCalls.length > 0 ? "tool_call" : "final_answer",
    ...(requestedToolCalls.length > 0 ? { toolName: requestedToolCalls[0].toolName } : {}),
    llmModel: input.plannerLlmModel,
    ...TokenUsageMapper.toSseFields(input.plannerTokenUsage),
  });

  if (requestedToolCalls.length > 0) {
    const batchId = crypto.randomUUID();
    for (const requestedCall of requestedToolCalls) {
      deps.enqueueRunTool({
        conversationId: input.conversationId,
        sourceEntryId: input.plannerEntryId,
        agentId: input.anchorUserMessage.agentId,
        toolName: requestedCall.toolName,
        params: {},
        toolRequest: requestedCall.toolRequest,
        batchId,
        agentToolConfig: agentToolConfigFor(deps, input.anchorUserMessage.agentId, requestedCall.toolName),
      });
    }
  }

  return { queuedToolCalls: requestedToolCalls.length, followup: agentic.followup };
}
