import type { RuntimeChatEntriesRepo, RuntimeHub } from '../steps/runtimeDeps.js';
import type { ThoughtExecution, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';

export type ToolParamsThought = ThoughtExecution & {
  thoughtType: 'toolParams';
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
  plannerFollowup?: 'continue' | 'finalize';
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
  plannerFollowup?: 'continue' | 'finalize';
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
  plannerFollowup?: 'continue' | 'finalize';
  requestStartedMs: number;
  result?: ThoughtReasonLlmResult;
};

export type ToolParamsThoughtTypeProviderDeps = {
  chatEntries: RuntimeChatEntriesRepo;
  hub: RuntimeHub;
  runToolTask: (input: {
    conversationId: string;
    sourceEntryId?: string;
    agentId: string | null;
    toolName: string;
    params: Record<string, unknown>;
    toolRequest: string;
    plannerFollowup?: 'continue' | 'finalize';
  }) => Promise<void>;
};

export function createToolParamsThoughtTypeProvider(
  deps: ToolParamsThoughtTypeProviderDeps,
): ThoughtTypeProvider<ToolParamsPrepareSeed, ToolParamsPrepareOutput, ToolParamsReasonOutput, ToolParamsThought> {
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
        ...(input.prepareOutput.plannerFollowup ? { plannerFollowup: input.prepareOutput.plannerFollowup } : {}),
        requestStartedMs: Date.now(),
      },
    }),
    runDecision: async (_step, input) => {
      const reason = input.reasonOutput;
      if (!reason.result) throw new Error('toolParams decision requires runtime-provided LLM result');
      const parsedParams = parseJsonObjectFromCompletionText(reason.result.fullResponse);
      deps.hub.publish(reason.conversationId, {
        type: 'planner.decision.tool_call',
        chatEntryId: reason.streamEntryId,
        toolName: reason.toolName,
      });
      await deps.runToolTask({
        conversationId: reason.conversationId,
        ...(reason.sourceEntryId ? { sourceEntryId: reason.sourceEntryId } : {}),
        agentId: reason.agentId,
        toolName: reason.toolName,
        params: parsedParams,
        toolRequest: reason.toolRequest,
        ...(reason.plannerFollowup ? { plannerFollowup: reason.plannerFollowup } : {}),
      });
    },
    getReasonLlmRequest: (input) => ({ prompt: input.reasonOutput.prompt }),
    onReasonLlmDelta: (input, delta) => {
      deps.hub.publish(input.reasonOutput.conversationId, {
        type: 'planner.llm.delta',
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
      llmRequest: input.seed.toolRequest,
      kind: 'planner',
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

function parseJsonObjectFromCompletionText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const codeFence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const jsonText = codeFence ? codeFence[1] : trimmed;
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('tool params resolver returned non-object JSON');
  }
  return parsed as Record<string, unknown>;
}
