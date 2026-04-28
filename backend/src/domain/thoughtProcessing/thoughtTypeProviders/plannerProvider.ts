import { buildPlannerPrompt, parseAgenticPlannerOutput } from "../../continueConversationPlannerProtocol.js";
import { parseRequestedToolCalls } from "../../decisionTaskProcessor/decisionResult.js";
import { incrementalDelta } from "../../decisionTaskProcessor/plannerStreamUtils.js";
import { extractAssistantOutputFromJsonLike } from "../../decisionTaskProcessor/plannerTextParsing.js";
import { finishThoughtLifecycle } from "../../thoughtLifecycle.js";
import type { ConversationEventHub } from "../../../events/conversationEventHub.js";
import type { ChatEntriesRepo } from "../../../infra/repositories/chatEntriesRepo.js";
import { SseType } from "../../../types/sse.js";
import type { ThoughtExecution, ThoughtReasonLlmResult, ThoughtTypeProvider } from "../types.js";

export type PlannerThought = ThoughtExecution & {
  thoughtType: "planner";
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId?: string;
};

export type PlannerPrepareSeed = {
  conversationId: string;
  anchorEntryId: string;
  agentId: string | null;
  userText: string;
  systemPrompt: string;
  enabledToolIds: string[];
};

export type PlannerPrepareOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  agentId: string | null;
  userText: string;
  llmRequest: string;
  enabledToolIds: string[];
};

export type PlannerReasonOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  agentId: string | null;
  userText: string;
  prompt: string;
  enabledToolIds: string[];
  requestStartedMs: number;
  streamedAnswer?: string;
  assistantEntryId?: string | null;
  result?: ThoughtReasonLlmResult;
};

export type PlannerThoughtTypeProviderDeps = {
  chatEntries: ChatEntriesRepo;
  hub: ConversationEventHub;
  executeToolRequest: (input: PlannerToolRequestExecutionInput) => Promise<void>;
};

export type PlannerToolRequestExecutionInput = {
  conversationId: string;
  continuationAnchorId: string;
  agentId: string | null;
  userText: string;
  enabledToolIds: string[];
  followup: "continue" | "finalize";
  toolName: string;
  toolRequest: string;
};

export function createPlannerThoughtTypeProvider(deps: PlannerThoughtTypeProviderDeps): ThoughtTypeProvider<
  PlannerPrepareSeed,
  PlannerPrepareOutput,
  PlannerReasonOutput,
  PlannerThought
> {
  const liveStreamState = new Map<
    string,
    {
      reconstructedReply: string;
      streamedAnswer: string;
      assistantEntryId: string | null;
    }
  >();
  return {
    runPrepare: async (_step, input) => ({
      thought: input.thought,
      prepareOutput: {
        conversationId: input.seed.conversationId,
        streamEntryId: input.thought.streamEntryId,
        thoughtActionEntryId: input.thought.thoughtActionEntryId ?? null,
        agentId: input.seed.agentId,
        userText: input.seed.userText,
        llmRequest: buildPlannerPrompt({
          systemPrompt: input.seed.systemPrompt,
          entries: deps.chatEntries.listMessages(input.seed.conversationId),
          anchorUserText: input.seed.userText,
          triggerEntry: deps.chatEntries.getMessage(input.seed.conversationId, input.seed.anchorEntryId),
          toolIds: input.seed.enabledToolIds,
          priorToolResults: [],
        }),
        enabledToolIds: input.seed.enabledToolIds,
      },
    }),
    runReason: async (_step, input) => ({
      thought: input.thought,
      reasonOutput: {
        conversationId: input.prepareOutput.conversationId,
        streamEntryId: input.prepareOutput.streamEntryId,
        thoughtActionEntryId: input.prepareOutput.thoughtActionEntryId,
        agentId: input.prepareOutput.agentId,
        userText: input.prepareOutput.userText,
        prompt: input.prepareOutput.llmRequest,
        enabledToolIds: input.prepareOutput.enabledToolIds,
        requestStartedMs: Date.now(),
      },
    }),
    runDecision: async (_step, input) => {
      const reason = input.reasonOutput;
      if (!reason.result) {
        throw new Error("planner decision requires runtime-provided LLM result");
      }
      let summary = "Planner response completed";
      let action = "final_answer";
      let toolName: string | undefined;
      let requestedToolCalls: Array<{ toolName: string; toolRequest: string }> = [];
      let decision: { type: "user-response"; text: string } | { type: "tool-invocation"; toolId: string; parameters: Record<string, unknown> } | null = null;
      let parseResult: { status: "ok"; parsed: ReturnType<typeof parseAgenticPlannerOutput>["output"] } | { status: "error"; error: string } = {
        status: "error",
        error: "Planner parsing not attempted",
      };
      try {
        const parsed = parseAgenticPlannerOutput({
          reply: reason.result.fullResponse,
          streamedAnswer: reason.streamedAnswer ?? "",
          isToolAvailable: (toolId) => reason.enabledToolIds.includes(toolId),
        });
        requestedToolCalls = parseRequestedToolCalls({
          requests: parsed.output.tool_requests,
          enabledToolIds: reason.enabledToolIds,
        });
        decision = parsed.decision;
        parseResult = {
          status: "ok",
          parsed: parsed.output,
        };
        if (requestedToolCalls.length > 0) {
          summary = `Queued ${requestedToolCalls.length} tool call(s)`;
          action = "tool_call";
          toolName = requestedToolCalls[0].toolName;
          const continuationAnchorId = reason.assistantEntryId ?? reason.thoughtActionEntryId ?? reason.streamEntryId;
          for (const requested of requestedToolCalls) {
            await deps.executeToolRequest({
              conversationId: reason.conversationId,
              continuationAnchorId,
              agentId: reason.agentId,
              userText: reason.userText,
              enabledToolIds: reason.enabledToolIds,
              followup: parsed.output.followup,
              toolName: requested.toolName,
              toolRequest: requested.toolRequest,
            });
          }
        } else {
          const assistantText = String(parsed.output.assistant_output ?? "").trim();
          summary = assistantText || "Planner completed";
          if (assistantText) {
            if (reason.assistantEntryId) {
              deps.chatEntries.updateAssistantMessage(reason.conversationId, {
                id: reason.assistantEntryId,
                text: assistantText,
              });
            } else {
              const assistant = deps.chatEntries.appendAssistantMessage(reason.conversationId, assistantText, {
                ...(reason.thoughtActionEntryId ? { parentId: reason.thoughtActionEntryId } : {}),
              });
              deps.hub.publish(reason.conversationId, {
                type: SseType.ASSISTANT_STREAM,
                chatEntryId: assistant.id,
                delta: assistantText,
                ...(reason.thoughtActionEntryId ? { parentId: reason.thoughtActionEntryId } : {}),
              });
            }
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        summary = detail;
        action = "failed";
        parseResult = {
          status: "error",
          error: detail,
        };
      }

      finishThoughtLifecycle({ chatEntries: deps.chatEntries, hub: deps.hub }, {
        conversationId: reason.conversationId,
        kind: "planner",
        streamEntryId: reason.streamEntryId,
        thoughtActionEntryId: reason.thoughtActionEntryId,
        llmRequest: reason.prompt,
        llmResponse: reason.result.fullResponse,
        thoughtMs: Math.max(0, Date.now() - reason.requestStartedMs),
        decision,
        status: action === "failed" ? "failed" : "completed",
        ...(action === "failed" ? { error: summary } : {}),
        llmProviderId: reason.result.providerId,
        llmModel: reason.result.model,
        usage: reason.result.usage,
        summary,
        action,
        ...(toolName ? { toolName } : {}),
        parseResult,
      });
    },
    getReasonLlmRequest: (input) => ({ prompt: input.reasonOutput.prompt }),
    onReasonLlmDelta: (input, delta) => {
      deps.hub.publish(input.reasonOutput.conversationId, {
        type: SseType.PLANNER_LLM_STREAM,
        chatEntryId: input.reasonOutput.streamEntryId,
        delta,
      });
      const state = liveStreamState.get(input.reasonOutput.streamEntryId) ?? {
        reconstructedReply: "",
        streamedAnswer: "",
        assistantEntryId: null,
      };
      state.reconstructedReply += delta;
      const streamedAssistantOutput = extractAssistantOutputFromJsonLike(state.reconstructedReply);
      const answerDelta = incrementalDelta(state.streamedAnswer, streamedAssistantOutput);
      if (answerDelta) {
        if (!state.assistantEntryId) {
          const assistant = deps.chatEntries.appendAssistantMessage(input.reasonOutput.conversationId, "", {
            ...(input.reasonOutput.thoughtActionEntryId ? { parentId: input.reasonOutput.thoughtActionEntryId } : {}),
          });
          state.assistantEntryId = assistant.id;
        }
        deps.hub.publish(input.reasonOutput.conversationId, {
          type: SseType.ASSISTANT_STREAM,
          chatEntryId: state.assistantEntryId,
          delta: answerDelta,
          ...(input.reasonOutput.thoughtActionEntryId ? { parentId: input.reasonOutput.thoughtActionEntryId } : {}),
        });
      }
      state.streamedAnswer = streamedAssistantOutput;
      liveStreamState.set(input.reasonOutput.streamEntryId, state);
    },
    applyReasonLlmResult: (input, result) => {
      const state = liveStreamState.get(input.reasonOutput.streamEntryId);
      liveStreamState.delete(input.reasonOutput.streamEntryId);
      return {
        ...input,
        reasonOutput: {
          ...input.reasonOutput,
          result,
          ...(state ? { streamedAnswer: state.streamedAnswer, assistantEntryId: state.assistantEntryId } : {}),
        },
      };
    },
    getLifecycleStartRequest: (input) => ({
      conversationId: input.seed.conversationId,
      parentId: input.seed.anchorEntryId,
      llmRequest: input.seed.userText,
      kind: "planner",
      includeAction: true,
      summary: "Decision planning",
    }),
    applyLifecycleStart: (input, started) => ({
      ...input,
      thought: {
        ...input.thought,
        thoughtId: started.thoughtId,
        conversationId: input.seed.conversationId,
        streamEntryId: started.streamEntryId,
        ...(started.thoughtActionEntryId ? { thoughtActionEntryId: started.thoughtActionEntryId } : {}),
      },
    }),
  };
}
