import { Injectable } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishConversationUpdated } from '../../sse/sse-helpers.js';
import type { ThoughtLifecycleEntries, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';

export type AutoTitleInput = {
  conversationId: string;
  firstMessage: string;
};

@Injectable()
export class AutoTitleThoughtTypeProvider implements ThoughtTypeProvider<AutoTitleInput, 'autoTitle'> {
  readonly thoughtType = 'autoTitle' as const;

  constructor(
    private readonly conversations: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
  ) {}

  buildInputFromConversation = async (conversationId: string): Promise<AutoTitleInput> => {
    const entries = await this.chatEntries.listMessages(conversationId);
    const firstUserMessage = entries.find((entry) => entry.type === 'user-message');
    if (!firstUserMessage) throw new Error(`autoTitle requires a user-message in conversation ${conversationId}`);
    return { conversationId, firstMessage: firstUserMessage.text };
  };

  getLifecycleStartRequest = (input: AutoTitleInput) => ({
    conversationId: input.conversationId,
    llmRequest: input.firstMessage,
    kind: 'title' as const,
    includeAction: true,
    summary: 'Title generation',
  });

  runPrepare = (input: AutoTitleInput) => ({
    prompt:
      'Generate a short conversation title (3-6 words max). Return plain text only.\n\n' +
      `First message: ${input.firstMessage}`,
  });

  onLlmDelta = (input: AutoTitleInput, lifecycle: ThoughtLifecycleEntries, delta: string): void => {
    if (!delta) return;
    this.hub.publish(input.conversationId, {
      type: SseType.TITLE_LLM_STREAM,
      chatEntryId: lifecycle.streamEntryId,
      delta,
    });
  };

  runDecision = async (
    input: AutoTitleInput,
    lifecycle: ThoughtLifecycleEntries,
    llmResult: ThoughtReasonLlmResult,
  ): Promise<void> => {
    const cleanTitle = normalizeGeneratedTitle(llmResult.fullResponse);
    const nextTitle = cleanTitle ?? fallbackConversationTitle(input.firstMessage);
    const current = await this.conversations.get(input.conversationId);
    if (!current) throw new Error(`conversation ${input.conversationId} disappeared mid-thought`);
    const titleApplied = current.title === 'New chat';
    if (titleApplied) await this.conversations.updateTitle(input.conversationId, nextTitle);

    await this.persistUsage(lifecycle, llmResult);
    await this.completeThoughtAction(lifecycle, nextTitle);
    this.publishTitleResponse(lifecycle, nextTitle, llmResult);
    if (titleApplied) await publishConversationUpdated(this.hub, this.conversations, input.conversationId);
  };

  private async persistUsage(lifecycle: ThoughtLifecycleEntries, llmResult: ThoughtReasonLlmResult): Promise<void> {
    if (!llmResult.usage) return;
    const patch: Record<string, unknown> = {
      promptTokens: llmResult.usage.promptTokens,
      completionTokens: llmResult.usage.completionTokens,
    };
    if (typeof llmResult.usage.cachedPromptTokens === 'number') {
      patch.cachedPromptTokens = llmResult.usage.cachedPromptTokens;
    }
    await this.chatEntries.mergeEntryPayload(lifecycle.conversationId, lifecycle.streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.streamEntryId);
  }

  private async completeThoughtAction(lifecycle: ThoughtLifecycleEntries, summary: string): Promise<void> {
    if (!lifecycle.thoughtActionEntryId) return;
    await this.chatEntries.updateThoughtAction(lifecycle.conversationId, lifecycle.thoughtActionEntryId, {
      status: 'completed',
      summary,
      action: 'final_answer',
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.thoughtActionEntryId);
  }

  private publishTitleResponse(lifecycle: ThoughtLifecycleEntries, summary: string, llmResult: ThoughtReasonLlmResult): void {
    const payload: {
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
      chatEntryId: lifecycle.streamEntryId,
      summary,
      finished: true,
      action: 'final_answer',
    };
    if (llmResult.providerId) payload.llmProviderId = llmResult.providerId;
    if (llmResult.model) payload.llmModel = llmResult.model;
    if (llmResult.usage) {
      payload.promptTokens = llmResult.usage.promptTokens;
      payload.completionTokens = llmResult.usage.completionTokens;
      if (typeof llmResult.usage.cachedPromptTokens === 'number') {
        payload.cachedPromptTokens = llmResult.usage.cachedPromptTokens;
      }
    }
    this.hub.publish(lifecycle.conversationId, payload);
  }
}

function fallbackConversationTitle(firstMessage: string): string {
  const text = String(firstMessage || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'New chat';
  return text.length > 64 ? `${text.slice(0, 64).trim()}...` : text;
}

function normalizeGeneratedTitle(fullResponse: string): string | null {
  const clean = fullResponse.replace(/\s+/g, ' ').replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!clean) return null;
  const bounded = clean.length > 80 ? clean.slice(0, 80).trim() : clean;
  if (!bounded) return null;
  if (!/[a-z0-9]/i.test(bounded)) return null;
  return bounded;
}
