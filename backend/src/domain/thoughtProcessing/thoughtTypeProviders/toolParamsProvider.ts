import { parseJsonObjectFromCompletionText } from "../../decisionTaskProcessor/plannerTextParsing.js";
import { finishThoughtLifecycle } from "../../thoughtLifecycle.js";
import type { ConversationEventHub } from "../../../events/conversationEventHub.js";
import type { ChatEntriesRepo } from "../../../infra/repositories/chatEntriesRepo.js";
import { SseType } from "../../../types/sse.js";
import type { ThoughtExecution, ThoughtReasonLlmResult, ThoughtTypeProvider } from "../types.js";
import type { RunToolTask } from "../../agentTask.js";
import type { RunToolTaskProcessor } from "../../runToolTaskProcessor.js";

export type ToolParamsThought = ThoughtExecution & {
  thoughtType: "toolParams";
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId?: string;
};

export type ToolParamsPrepareSeed = {
  conversationId: string;
  sourceEntryId?: string;
  agentId: string | null;
  toolName: string;
  toolAiDescription: string;
  toolParamsSchema: unknown;
  toolRequest: string;
  agentToolConfig?: RunToolTask["agentToolConfig"];
  plannerFollowup?: RunToolTask["plannerFollowup"];
};

export type ToolParamsPrepareOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  sourceEntryId: string | null;
  agentId: string | null;
  toolName: string;
  resolverPrompt: string;
  toolRequest: string;
  agentToolConfig?: RunToolTask["agentToolConfig"];
  plannerFollowup?: RunToolTask["plannerFollowup"];
};

export type ToolParamsReasonOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  sourceEntryId: string | null;
  agentId: string | null;
  toolName: string;
  toolRequest: string;
  prompt: string;
  agentToolConfig?: RunToolTask["agentToolConfig"];
  plannerFollowup?: RunToolTask["plannerFollowup"];
  requestStartedMs: number;
  result?: ThoughtReasonLlmResult;
};

export type ToolParamsThoughtTypeProviderDeps = {
  chatEntries: ChatEntriesRepo;
  hub: ConversationEventHub;
  runToolTaskProcessor: RunToolTaskProcessor;
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
        sourceEntryId: input.seed.sourceEntryId ?? null,
        agentId: input.seed.agentId,
        toolName: input.seed.toolName,
        resolverPrompt: buildToolParamsPrompt(
          input.seed.toolName,
          input.seed.toolAiDescription,
          input.seed.toolParamsSchema,
          input.seed.toolRequest,
        ),
        toolRequest: input.seed.toolRequest,
        ...(input.seed.agentToolConfig ? { agentToolConfig: input.seed.agentToolConfig } : {}),
        ...(input.seed.plannerFollowup ? { plannerFollowup: input.seed.plannerFollowup } : {}),
      },
    }),
    runReason: async (_step, input) => ({
      thought: input.thought,
      reasonOutput: {
        conversationId: input.prepareOutput.conversationId,
        streamEntryId: input.prepareOutput.streamEntryId,
        thoughtActionEntryId: input.prepareOutput.thoughtActionEntryId,
        sourceEntryId: input.prepareOutput.sourceEntryId,
        agentId: input.prepareOutput.agentId,
        toolName: input.prepareOutput.toolName,
        toolRequest: input.prepareOutput.toolRequest,
        prompt: input.prepareOutput.resolverPrompt,
        ...(input.prepareOutput.agentToolConfig ? { agentToolConfig: input.prepareOutput.agentToolConfig } : {}),
        ...(input.prepareOutput.plannerFollowup ? { plannerFollowup: input.prepareOutput.plannerFollowup } : {}),
        requestStartedMs: Date.now(),
      },
    }),
    runDecision: async (_step, input) => {
      const reason = input.reasonOutput;
      if (!reason.result) {
        throw new Error("toolParams decision requires runtime-provided LLM result");
      }
      let parsedParams: Record<string, unknown>;
      try {
        parsedParams = parseJsonObjectFromCompletionText({
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
          parameters: parsedParams,
        },
        status: "completed",
        llmProviderId: reason.result.providerId,
        llmModel: reason.result.model,
        usage: reason.result.usage,
        summary: `Resolved parameters for ${reason.toolName}`,
        action: "tool_call",
        toolName: reason.toolName,
      });
      await deps.runToolTaskProcessor.process({
        conversationId: reason.conversationId,
        ...(reason.sourceEntryId ? { sourceEntryId: reason.sourceEntryId } : {}),
        agentId: reason.agentId,
        toolName: reason.toolName,
        params: parsedParams,
        toolRequest: reason.toolRequest,
        ...(reason.agentToolConfig ? { agentToolConfig: reason.agentToolConfig } : {}),
        ...(reason.plannerFollowup ? { plannerFollowup: reason.plannerFollowup } : {}),
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
      ...(input.seed.sourceEntryId ? { parentId: input.seed.sourceEntryId } : {}),
      llmRequest: buildToolParamsPrompt(
        input.seed.toolName,
        input.seed.toolAiDescription,
        input.seed.toolParamsSchema,
        input.seed.toolRequest,
      ),
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

function buildToolParamsPrompt(
  toolName: string,
  toolAiDescription: string,
  toolParamsSchema: unknown,
  toolRequest: string,
): string {
  return `You produce ONLY JSON object parameters for one tool.

Tool name: ${toolName}
Tool AI description: ${toolAiDescription}
Tool parameter JSON schema:
${JSON.stringify(toolParamsSchema, null, 2)}

Tool request:
${toolRequest}

Return ONLY valid JSON object for tool parameters.`;
}
