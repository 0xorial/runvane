import type { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import type { RuntimeHub } from '../steps/runtimeDeps.js';
import type { ThoughtExecution, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';

export type AutoTitleThought = ThoughtExecution & {
  thoughtType: 'autoTitle';
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId?: string;
};

export type AutoTitlePrepareSeed = {
  firstMessage: string;
};

export type AutoTitlePrepareOutput = {
  conversationId: string;
  streamEntryId: string;
  titlePrompt: string;
  fallbackTitle: string;
};

export type AutoTitleReasonOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  prompt: string;
  requestStartedMs: number;
  result?: ThoughtReasonLlmResult;
  fallbackTitle: string;
};

export type AutoTitleThoughtTypeProviderDeps = {
  conversations: ConversationsRepo;
  hub: RuntimeHub;
};

export function createAutoTitleThoughtTypeProvider(
  deps: AutoTitleThoughtTypeProviderDeps,
): ThoughtTypeProvider<AutoTitlePrepareSeed, AutoTitlePrepareOutput, AutoTitleReasonOutput, AutoTitleThought> {
  return {
    runPrepare: async (_step, input) => ({
      thought: input.thought,
      prepareOutput: {
        conversationId: input.thought.conversationId,
        streamEntryId: input.thought.streamEntryId,
        titlePrompt: buildTitlePrompt(input.seed.firstMessage),
        fallbackTitle: fallbackConversationTitle(input.seed.firstMessage),
      },
    }),
    runReason: async (_step, input) => ({
      thought: input.thought,
      reasonOutput: {
        conversationId: input.prepareOutput.conversationId,
        streamEntryId: input.prepareOutput.streamEntryId,
        thoughtActionEntryId: input.thought.thoughtActionEntryId ?? null,
        prompt: input.prepareOutput.titlePrompt,
        requestStartedMs: Date.now(),
        fallbackTitle: input.prepareOutput.fallbackTitle,
      },
    }),
    runDecision: async (_step, input) => {
      const result = input.reasonOutput;
      if (!result.result) throw new Error('autoTitle decision requires runtime-provided LLM result');
      const cleanTitle = normalizeGeneratedTitle(result.result.fullResponse);
      const nextTitle = cleanTitle ?? result.fallbackTitle;
      const current = await deps.conversations.get(result.conversationId);
      if (!current || current.title.trim() !== 'New chat') return;
      const updated = await deps.conversations.updateTitle(result.conversationId, nextTitle);
      if (!updated) return;
      deps.hub.publish(result.conversationId, {
        type: 'conversation.updated',
        conversationId: updated.id,
      });
    },
    getReasonLlmRequest: (input) => ({ prompt: input.reasonOutput.prompt }),
    onReasonLlmDelta: (input, delta) => {
      deps.hub.publish(input.reasonOutput.conversationId, {
        type: 'title.llm.delta',
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
      conversationId: input.thought.conversationId,
      llmRequest: input.seed.firstMessage,
      kind: 'title',
      includeAction: true,
      summary: 'Title generation',
    }),
    applyLifecycleStart: (input, started) => ({
      ...input,
      thought: {
        ...input.thought,
        thoughtId: started.thoughtId,
        streamEntryId: started.streamEntryId,
        ...(started.thoughtActionEntryId ? { thoughtActionEntryId: started.thoughtActionEntryId } : {}),
      },
    }),
  };
}

function fallbackConversationTitle(firstMessage: string): string {
  const text = String(firstMessage || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'New chat';
  return text.length > 64 ? `${text.slice(0, 64).trim()}...` : text;
}

function buildTitlePrompt(firstMessage: string): string {
  return (
    'Generate a short conversation title (3-6 words max). Return plain text only.\n\n' + `First message: ${firstMessage}`
  );
}

function normalizeGeneratedTitle(fullResponse: string): string | null {
  const clean = fullResponse
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  if (!clean) return null;
  const bounded = clean.length > 80 ? clean.slice(0, 80).trim() : clean;
  if (!bounded) return null;
  if (!/[a-z0-9]/i.test(bounded)) return null;
  return bounded;
}
