import { Injectable } from '@nestjs/common';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishConversationUpdated, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

export type AutoTitleInput = {
  conversationId: string;
  firstMessage: string;
};

@Injectable()
export class AutoTitleThoughtTypeProvider implements ThoughtTypeProvider<AutoTitleInput> {
  readonly streamEntryType = 'title_llm_stream' as const;
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
      textMessage(
        'system',
        'Your job is to title this conversation in 3-6 words based on the first user message. Plain text, no quotes.',
      ),
      textMessage('user', input.firstMessage),
      // Force-skip the model's reasoning phase by prefilling the assistant
      // turn with an already-closed thinking block. This is the only
      // workaround that reliably suppresses thinking for Qwen3.5 in
      // LM Studio's OpenAI-compat endpoint — `/no_think` is silently
      // ignored on 3.5, and `chat_template_kwargs.enable_thinking=false`
      // is dropped by LM Studio's REST translation layer
      // (lmstudio-ai/lmstudio-bug-tracker#1559, reproduced Apr 2026).
      // Harmless on Anthropic (native prefill) and on non-reasoning models
      // that just continue from the prefix; the response cleanup strips
      // any leftover `<think>…</think>` from the title.
      { role: 'assistant', parts: [{ kind: 'text', text: '<think></think>\n\n' }] },
    ],
  });

  onLlmEvent = (_input: AutoTitleInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.streamEntryId) return;
    publishStreamFieldDelta(this.hub, ctx.conversationId, ctx.streamEntryId, event);
  };

  runDecision = async (input: AutoTitleInput, ctx: ThoughtContext, completion: LlmCompletion): Promise<void> => {
    const cleanTitle = normalizeGeneratedTitle(getCompletionText(completion));
    const nextTitle = cleanTitle ?? fallbackConversationTitle(input.firstMessage);
    const current = await this.conversations.get(input.conversationId);
    if (!current) throw new Error(`conversation ${input.conversationId} disappeared mid-thought`);
    const titleApplied = current.title === 'New chat';
    if (titleApplied) await this.conversations.updateTitle(input.conversationId, nextTitle);

    await this.completeThoughtAction(ctx, nextTitle);
    if (titleApplied) await publishConversationUpdated(this.hub, this.conversations, input.conversationId);
  };

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
  const text = String(firstMessage || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'New chat';
  return text.length > 64 ? `${text.slice(0, 64).trim()}...` : text;
}

function normalizeGeneratedTitle(fullResponse: string): string | null {
  const clean = fullResponse
    // Some servers (or template configs) leave Qwen `<think>…</think>` blocks
    // inline in `content` rather than routing them to `reasoning_content`.
    // Strip any such block so it never leaks into the conversation title.
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  if (!clean) return null;
  const bounded = clean.length > 80 ? clean.slice(0, 80).trim() : clean;
  if (!bounded) return null;
  if (!/[a-z0-9]/i.test(bounded)) return null;
  return bounded;
}
