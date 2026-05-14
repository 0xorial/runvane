import { Injectable } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishConversationUpdated } from '../../sse/sse-helpers.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

export type AutoTitleInput = {
  conversationId: string;
  firstMessage: string;
};

@Injectable()
export class AutoTitleThoughtTypeProvider implements ThoughtTypeProvider<AutoTitleInput> {
  readonly streamEntryType = 'title_llm_stream' as const;
  readonly wantsAction = true;
  readonly prepareTitle = 'Title generation';

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

  runPrepare = (input: AutoTitleInput): LlmRequest => ({
    messages: [
      textMessage('system', 'Title this conversation in 3-6 words. Plain text, no quotes.'),
      textMessage('user', input.firstMessage),
    ],
  });

  onLlmEvent = (_input: AutoTitleInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (event.type !== 'text_delta' || !event.delta || !ctx.streamEntryId) return;
    this.hub.publish(ctx.conversationId, {
      type: SseType.CHAT_ENTRY_DELTA,
      chatEntryId: ctx.streamEntryId,
      field: 'llmResponse',
      delta: event.delta,
    });
  };

  runDecision = async (
    input: AutoTitleInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
  ): Promise<void> => {
    const cleanTitle = normalizeGeneratedTitle(getCompletionText(completion));
    const nextTitle = cleanTitle ?? fallbackConversationTitle(input.firstMessage);
    const current = await this.conversations.get(input.conversationId);
    if (!current) throw new Error(`conversation ${input.conversationId} disappeared mid-thought`);
    const titleApplied = current.title === 'New chat';
    if (titleApplied) await this.conversations.updateTitle(input.conversationId, nextTitle);

    await this.persistUsage(ctx, completion);
    await this.completeThoughtAction(ctx, nextTitle);
    if (titleApplied) await publishConversationUpdated(this.hub, this.conversations, input.conversationId);
  };

  private async persistUsage(ctx: ThoughtContext, completion: LlmCompletion): Promise<void> {
    if (!completion.usage || !ctx.streamEntryId) return;
    const patch: Record<string, unknown> = {
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
    };
    if (typeof completion.usage.cachedPromptTokens === 'number') {
      patch.cachedPromptTokens = completion.usage.cachedPromptTokens;
    }
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, ctx.streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.streamEntryId);
  }

  private async completeThoughtAction(ctx: ThoughtContext, summary: string): Promise<void> {
    if (!ctx.thoughtActionEntryId) return;
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
      status: 'completed',
      summary,
      action: 'final_answer',
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
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
