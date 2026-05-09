import { Injectable } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishConversationUpdated } from '../../sse/sse-helpers.js';
import type { ThoughtExecution, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';

export type AutoTitleThought = ThoughtExecution & {
  thoughtType: 'autoTitle';
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

type AutoTitleProviderContract = ThoughtTypeProvider<
  AutoTitlePrepareSeed,
  AutoTitlePrepareOutput,
  AutoTitleReasonOutput,
  AutoTitleThought
>;

@Injectable()
export class AutoTitleThoughtTypeProvider implements AutoTitleProviderContract {
  constructor(
    private readonly conversations: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
  ) {}

  createPrepareInput: NonNullable<AutoTitleProviderContract['createPrepareInput']> = async ({ conversationId }) => {
    const entries = await this.chatEntries.listMessages(conversationId);
    const firstUserMessage = entries.find((entry) => entry.type === 'user-message');
    if (!firstUserMessage) {
      throw new Error(`autoTitle requires a user-message in conversation ${conversationId}`);
    }
    return {
      thought: {
        thoughtType: 'autoTitle',
        thoughtId: crypto.randomUUID(),
        conversationId,
        prepareEntryId: '',
        streamEntryId: '',
      },
      seed: { firstMessage: firstUserMessage.text },
    };
  };

  runPrepare: AutoTitleProviderContract['runPrepare'] = async (_step, input) => ({
    thought: input.thought,
    prepareOutput: {
      conversationId: input.thought.conversationId,
      streamEntryId: input.thought.streamEntryId,
      titlePrompt: buildTitlePrompt(input.seed.firstMessage),
      fallbackTitle: fallbackConversationTitle(input.seed.firstMessage),
    },
  });

  runReason: AutoTitleProviderContract['runReason'] = async (_step, input) => ({
    thought: input.thought,
    reasonOutput: {
      conversationId: input.prepareOutput.conversationId,
      streamEntryId: input.prepareOutput.streamEntryId,
      thoughtActionEntryId: input.thought.thoughtActionEntryId ?? null,
      prompt: input.prepareOutput.titlePrompt,
      requestStartedMs: Date.now(),
      fallbackTitle: input.prepareOutput.fallbackTitle,
    },
  });

  runDecision: AutoTitleProviderContract['runDecision'] = async (_step, input) => {
    const result = input.reasonOutput;
    if (!result.result) throw new Error('autoTitle decision requires runtime-provided LLM result');
    const cleanTitle = normalizeGeneratedTitle(result.result.fullResponse);
    const nextTitle = cleanTitle ?? result.fallbackTitle;
    const current = await this.conversations.get(result.conversationId);
    if (!current) throw new Error(`conversation ${result.conversationId} disappeared mid-thought`);
    const titleApplied = current.title === 'New chat';
    if (titleApplied) {
      await this.conversations.updateTitle(result.conversationId, nextTitle);
    }

    const usage = result.result.usage;
    if (usage) {
      const usagePatch: Record<string, unknown> = {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      };
      if (typeof usage.cachedPromptTokens === 'number') usagePatch.cachedPromptTokens = usage.cachedPromptTokens;
      await this.chatEntries.mergeEntryPayload(result.conversationId, input.thought.streamEntryId, usagePatch);
      await publishChatEntryUpsert(this.hub, this.chatEntries, result.conversationId, input.thought.streamEntryId);
    }

    const summary = nextTitle;
    if (input.thought.thoughtActionEntryId) {
      await this.chatEntries.updateThoughtAction(result.conversationId, input.thought.thoughtActionEntryId, {
        status: 'completed',
        summary,
        action: 'final_answer',
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, result.conversationId, input.thought.thoughtActionEntryId);
    }

    const titlePayload: {
      type: typeof SseType.TITLE_RESPONSE;
      chatEntryId: string;
      summary: string;
      finished: boolean;
      action?: string;
      llmProviderId?: string;
      llmModel?: string;
      promptTokens?: number;
      cachedPromptTokens?: number;
      completionTokens?: number;
    } = {
      type: SseType.TITLE_RESPONSE,
      chatEntryId: input.thought.streamEntryId,
      summary,
      finished: true,
      action: 'final_answer',
    };
    if (result.result.providerId) titlePayload.llmProviderId = result.result.providerId;
    if (result.result.model) titlePayload.llmModel = result.result.model;
    if (result.result.usage) {
      titlePayload.promptTokens = result.result.usage.promptTokens;
      titlePayload.completionTokens = result.result.usage.completionTokens;
      if (typeof result.result.usage.cachedPromptTokens === 'number') {
        titlePayload.cachedPromptTokens = result.result.usage.cachedPromptTokens;
      }
    }
    this.hub.publish(result.conversationId, titlePayload);

    if (titleApplied) {
      await publishConversationUpdated(this.hub, this.conversations, result.conversationId);
    }
  };

  getReasonLlmRequest: NonNullable<AutoTitleProviderContract['getReasonLlmRequest']> = (input) => ({
    prompt: input.reasonOutput.prompt,
  });

  onReasonLlmDelta: NonNullable<AutoTitleProviderContract['onReasonLlmDelta']> = (input, delta) => {
    if (!delta) return;
    this.hub.publish(input.reasonOutput.conversationId, {
      type: SseType.TITLE_LLM_STREAM,
      chatEntryId: input.reasonOutput.streamEntryId,
      delta,
    });
  };

  applyReasonLlmResult: NonNullable<AutoTitleProviderContract['applyReasonLlmResult']> = (input, result) => ({
    ...input,
    reasonOutput: {
      ...input.reasonOutput,
      result,
    },
  });

  getLifecycleStartRequest: NonNullable<AutoTitleProviderContract['getLifecycleStartRequest']> = (input) => ({
    conversationId: input.thought.conversationId,
    llmRequest: input.seed.firstMessage,
    kind: 'title',
    includeAction: true,
    summary: 'Title generation',
  });

  applyLifecycleStart: NonNullable<AutoTitleProviderContract['applyLifecycleStart']> = (input, started) => {
    const thought: AutoTitleThought = {
      ...input.thought,
      thoughtId: started.thoughtId,
      prepareEntryId: started.prepareEntryId,
      streamEntryId: started.streamEntryId,
    };
    if (started.thoughtActionEntryId) thought.thoughtActionEntryId = started.thoughtActionEntryId;
    return { ...input, thought };
  };

  getPreparedReasonInfo: NonNullable<AutoTitleProviderContract['getPreparedReasonInfo']> = (input) => ({
    requestText: input.prepareOutput.titlePrompt,
  });
}

function fallbackConversationTitle(firstMessage: string): string {
  const text = String(firstMessage || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'New chat';
  return text.length > 64 ? `${text.slice(0, 64).trim()}...` : text;
}

function buildTitlePrompt(firstMessage: string): string {
  return 'Generate a short conversation title (3-6 words max). Return plain text only.\n\n' + `First message: ${firstMessage}`;
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
