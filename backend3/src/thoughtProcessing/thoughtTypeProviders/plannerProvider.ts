import type { RuntimeChatEntriesRepo, RuntimeHub } from '../steps/runtimeDeps.js';
import type { ThoughtExecution, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';

export type PlannerThought = ThoughtExecution & {
  thoughtType: 'planner';
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

export type PlannerToolRequestExecutionInput = {
  conversationId: string;
  continuationAnchorId: string;
  agentId: string | null;
  userText: string;
  enabledToolIds: string[];
  followup: 'continue' | 'finalize';
  toolName: string;
  toolRequest: string;
};

export type PlannerThoughtTypeProviderDeps = {
  chatEntries: RuntimeChatEntriesRepo;
  hub: RuntimeHub;
  executeToolRequest: (input: PlannerToolRequestExecutionInput) => Promise<void>;
};

type ParsedPlannerOutput = {
  assistantOutput: string;
  toolRequests: Array<{ toolName: string; toolRequest: string }>;
  followup: 'continue' | 'finalize';
};

export function createPlannerThoughtTypeProvider(
  deps: PlannerThoughtTypeProviderDeps,
): ThoughtTypeProvider<PlannerPrepareSeed, PlannerPrepareOutput, PlannerReasonOutput, PlannerThought> {
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
        llmRequest: buildPlannerPrompt(input.seed.systemPrompt, input.seed.userText, input.seed.enabledToolIds),
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
      if (!reason.result) throw new Error('planner decision requires runtime-provided LLM result');
      const parsed = parsePlannerOutput(reason.result.fullResponse);
      const requestedToolCalls = parsed.toolRequests.filter((t) => reason.enabledToolIds.includes(t.toolName));

      if (requestedToolCalls.length > 0) {
        const continuationAnchorId = reason.assistantEntryId ?? reason.thoughtActionEntryId ?? reason.streamEntryId;
        for (const requested of requestedToolCalls) {
          await deps.executeToolRequest({
            conversationId: reason.conversationId,
            continuationAnchorId,
            agentId: reason.agentId,
            userText: reason.userText,
            enabledToolIds: reason.enabledToolIds,
            followup: parsed.followup,
            toolName: requested.toolName,
            toolRequest: requested.toolRequest,
          });
        }
        deps.hub.publish(reason.conversationId, {
          type: 'planner.decision.tool_calls',
          chatEntryId: reason.streamEntryId,
          queuedToolCalls: requestedToolCalls.length,
        });
        return;
      }

      const assistantText = parsed.assistantOutput.trim();
      if (!assistantText) return;
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
          type: 'assistant.stream',
          chatEntryId: assistant.id,
          delta: assistantText,
          ...(reason.thoughtActionEntryId ? { parentId: reason.thoughtActionEntryId } : {}),
        });
      }
    },
    getReasonLlmRequest: (input) => ({ prompt: input.reasonOutput.prompt }),
    onReasonLlmDelta: (input, delta) => {
      deps.hub.publish(input.reasonOutput.conversationId, {
        type: 'planner.llm.delta',
        chatEntryId: input.reasonOutput.streamEntryId,
        delta,
      });
      const state = liveStreamState.get(input.reasonOutput.streamEntryId) ?? {
        reconstructedReply: '',
        streamedAnswer: '',
        assistantEntryId: null,
      };
      state.reconstructedReply += delta;
      const streamedAssistantOutput = extractAssistantOutputFromJsonLike(state.reconstructedReply);
      const answerDelta = incrementalDelta(state.streamedAnswer, streamedAssistantOutput);
      if (answerDelta) {
        if (!state.assistantEntryId) {
          const assistant = deps.chatEntries.appendAssistantMessage(input.reasonOutput.conversationId, '', {
            ...(input.reasonOutput.thoughtActionEntryId ? { parentId: input.reasonOutput.thoughtActionEntryId } : {}),
          });
          state.assistantEntryId = assistant.id;
        }
        deps.hub.publish(input.reasonOutput.conversationId, {
          type: 'assistant.stream',
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
      kind: 'planner',
      includeAction: true,
      summary: 'Decision planning',
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

function buildPlannerPrompt(systemPrompt: string, userText: string, toolIds: string[]): string {
  return [
    'You are a planner. Return JSON with assistant_output and optional tool_requests.',
    `System prompt: ${systemPrompt || '(empty)'}`,
    `Allowed tools: ${toolIds.join(', ') || '(none)'}`,
    `User message: ${userText}`,
  ].join('\n');
}

function extractAssistantOutputFromJsonLike(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const value = (parsed as { assistant_output?: unknown }).assistant_output;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function incrementalDelta(previous: string, next: string): string {
  if (!next) return '';
  if (!previous) return next;
  if (next.startsWith(previous)) return next.slice(previous.length);
  return '';
}

function parsePlannerOutput(reply: string): ParsedPlannerOutput {
  try {
    const parsed = JSON.parse(reply) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { assistantOutput: reply, toolRequests: [], followup: 'finalize' };
    }
    const rec = parsed as {
      assistant_output?: unknown;
      tool_requests?: unknown;
      followup?: unknown;
    };
    const toolRequests = Array.isArray(rec.tool_requests)
      ? rec.tool_requests
          .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
          .map((item) => {
            const row = item as { tool_name?: unknown; tool_request?: unknown };
            return {
              toolName: typeof row.tool_name === 'string' ? row.tool_name.trim() : '',
              toolRequest: typeof row.tool_request === 'string' ? row.tool_request : '',
            };
          })
          .filter((x) => x.toolName.length > 0)
      : [];
    return {
      assistantOutput: typeof rec.assistant_output === 'string' ? rec.assistant_output : reply,
      toolRequests,
      followup: rec.followup === 'continue' ? 'continue' : 'finalize',
    };
  } catch {
    return { assistantOutput: reply, toolRequests: [], followup: 'finalize' };
  }
}
