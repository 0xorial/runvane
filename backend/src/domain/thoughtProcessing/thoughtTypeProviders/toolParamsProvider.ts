import { parseJsonObjectFromCompletionText } from "../../decisionTaskProcessor/plannerTextParsing.js";
import { finishThoughtLifecycle } from "../../thoughtLifecycle.js";
import type { ConversationEventHub } from "../../../events/conversationEventHub.js";
import type { ChatEntriesRepo } from "../../../infra/repositories/chatEntriesRepo.js";
import { SseType } from "../../../types/sse.js";
import type { ThoughtExecution, ThoughtReasonLlmResult, ThoughtTypeProvider } from "../types.js";

type ToolParamsThought = ThoughtExecution & {
  thoughtType: "toolParams";
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId?: string;
};

export type ToolParamsPrepareSeed = {
  conversationId: string;
  toolName: string;
  toolRequest: string;
};

export type ToolParamsPrepareOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  toolName: string;
  resolverPrompt: string;
};

export type ToolParamsReasonOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  toolName: string;
  prompt: string;
  requestStartedMs: number;
  result?: ThoughtReasonLlmResult;
};

export type ToolParamsThoughtTypeProviderDeps = {
  chatEntries: ChatEntriesRepo;
  hub: ConversationEventHub;
};

export function createToolParamsThoughtTypeProvider(deps: ToolParamsThoughtTypeProviderDeps): ThoughtTypeProvider<
  ToolParamsPrepareSeed,
  ToolParamsPrepareOutput,
  ToolParamsReasonOutput,
  ToolParamsThought
> {
  return {
    runPrepare: async (_step, input) => ({
      thought: input.thought,
      prepareOutput: {
        conversationId: input.seed.conversationId,
        streamEntryId: input.thought.streamEntryId,
        thoughtActionEntryId: input.thought.thoughtActionEntryId ?? null,
        toolName: input.seed.toolName,
        resolverPrompt: buildToolParamsPrompt(input.seed.toolName, input.seed.toolRequest),
      },
    }),
    runReason: async (_step, input) => ({
      thought: input.thought,
      reasonOutput: {
        conversationId: input.prepareOutput.conversationId,
        streamEntryId: input.prepareOutput.streamEntryId,
        thoughtActionEntryId: input.prepareOutput.thoughtActionEntryId,
        toolName: input.prepareOutput.toolName,
        prompt: input.prepareOutput.resolverPrompt,
        requestStartedMs: Date.now(),
      },
    }),
    runDecision: async (_step, input) => {
      const reason = input.reasonOutput;
      if (!reason.result) {
        throw new Error("toolParams decision requires runtime-provided LLM result");
      }
      try {
        parseJsonObjectFromCompletionText({
          text: reason.result.fullResponse,
          context: `tool resolver response for ${reason.toolName}`,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        finishThoughtLifecycle({ chatEntries: deps.chatEntries, hub: deps.hub }, {
          conversationId: reason.conversationId,
          kind: "planner",
          streamEntryId: reason.streamEntryId,
          thoughtActionEntryId: reason.thoughtActionEntryId,
          llmRequest: reason.prompt,
          llmResponse: reason.result.fullResponse,
          thoughtMs: Math.max(0, Date.now() - reason.requestStartedMs),
          decision: null,
          status: "failed",
          error: detail,
          llmProviderId: reason.result.providerId,
          llmModel: reason.result.model,
          usage: reason.result.usage,
          summary: detail,
          action: "failed",
        });
        throw error;
      }
      finishThoughtLifecycle({ chatEntries: deps.chatEntries, hub: deps.hub }, {
        conversationId: reason.conversationId,
        kind: "planner",
        streamEntryId: reason.streamEntryId,
        thoughtActionEntryId: reason.thoughtActionEntryId,
        llmRequest: reason.prompt,
        llmResponse: reason.result.fullResponse,
        thoughtMs: Math.max(0, Date.now() - reason.requestStartedMs),
        decision: {
          type: "tool-invocation",
          toolId: reason.toolName,
          parameters: {},
        },
        status: "completed",
        llmProviderId: reason.result.providerId,
        llmModel: reason.result.model,
        usage: reason.result.usage,
        summary: `Resolved parameters for ${reason.toolName}`,
        action: "tool_call",
        toolName: reason.toolName,
      });
    },
    getReasonLlmRequest: (input) => ({ prompt: input.reasonOutput.prompt }),
    onReasonLlmDelta: (input, delta) => {
      deps.hub.publish(input.reasonOutput.conversationId, {
        type: SseType.PLANNER_LLM_STREAM,
        chatEntryId: input.reasonOutput.streamEntryId,
        delta,
      });
    },
    applyReasonLlmResult: (input, result) => ({
      ...input,
      reasonOutput: {
        ...input.reasonOutput,
        result,
      },
    }),
    getLifecycleStartRequest: (input) => ({
      conversationId: input.seed.conversationId,
      llmRequest: input.seed.toolRequest,
      kind: "planner",
      includeAction: true,
      summary: `Resolve ${input.seed.toolName} parameters`,
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

function buildToolParamsPrompt(toolName: string, toolRequest: string): string {
  return `You produce ONLY JSON object parameters for one tool.

Tool name: ${toolName}
Tool request:
${toolRequest}

Return ONLY valid JSON object for tool parameters.`;
}
