import { Injectable, Logger } from '@nestjs/common';
import {
  CONVERSATION_CATEGORIZATION_SETTING_KEY,
  normalizeConversationCategorizationConfig,
} from '../../contracts/conversation-config.js';
import { AppSettingsRepo } from '../../db/repositories/app-settings.repo.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishConversationUpdated, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

/** Fixed reminder appended to every categorization prompt. Kept stable (and
 *  prompt-independent) so deterministic test stubs can recognise the request. */
const CATEGORIZATION_FORMAT_REMINDER = 'Reply with ONLY the category name on a single line.';

export type CategorizeInput = {
  conversationId: string;
  title: string;
  firstUserText: string;
  knownCategories: string[];
  prompt: string;
};

/**
 * Classifies a conversation from its first user message and assigns it to a
 * group (creating the group when the category is new). Unlike auto-title there
 * is no separate output entry — `runDecision` writes the group on the
 * conversation and records the chosen category as the thought-action summary.
 *
 * Gating (feature enabled, group not pinned, a first user message exists) lives
 * in the trigger, not here: the conversation-processor checks it before
 * starting this thought on the run (first message) or standalone (unpin).
 */
@Injectable()
export class CategorizeThoughtTypeProvider implements ThoughtTypeProvider<CategorizeInput> {
  readonly thoughtType = 'categorize' as const;
  readonly prepareTitle = 'Categorize conversation';
  readonly initialActionSummary = 'Choosing a category';

  private readonly logger = new Logger(CategorizeThoughtTypeProvider.name);

  constructor(
    private readonly appSettings: AppSettingsRepo,
    private readonly conversations: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
  ) {}

  buildInputFromConversation = async (conversationId: string): Promise<CategorizeInput> => {
    const config = normalizeConversationCategorizationConfig(
      await this.appSettings.getJson(CONVERSATION_CATEGORIZATION_SETTING_KEY),
    );
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new Error(`categorize requires conversation ${conversationId}`);

    const messages = await this.chatEntries.listMessages(conversationId);
    const firstUser = messages.find((entry) => entry.type === 'user-message');
    const firstUserText = firstUser && 'text' in firstUser ? String(firstUser.text ?? '').trim() : '';
    if (!firstUserText) throw new Error(`categorize requires a user message in conversation ${conversationId}`);

    const groups = await this.conversations.listGroups();
    const knownCategories = dedupeCategories([...config.seedCategories, ...groups.map((g) => g.name)]);
    return { conversationId, title: conversation.title, firstUserText, knownCategories, prompt: config.prompt };
  };

  runPrepare = (input: CategorizeInput): LlmRequest => {
    const categoryList = input.knownCategories.length > 0 ? input.knownCategories.join(', ') : '(none yet)';
    const system = [
      input.prompt,
      '',
      `Existing categories (prefer one of these): ${categoryList}.`,
      CATEGORIZATION_FORMAT_REMINDER,
    ].join('\n');
    const titleLine = input.title && input.title !== 'New chat' ? `Title: ${input.title}\n` : '';
    return {
      messages: [
        textMessage('system', system),
        textMessage('user', `${titleLine}First message:\n${input.firstUserText}`),
        // Mirror auto-title: prefill a closed thinking block to suppress local
        // models' reasoning phase so the response is just the category.
        { role: 'assistant', parts: [{ kind: 'text', text: '<think></think>\n\n' }] },
      ],
    };
  };

  onLlmEvent = (_input: CategorizeInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.streamEntryId) return;
    publishStreamFieldDelta(this.hub, ctx.conversationId, ctx.streamEntryId, event);
  };

  runDecision = async (input: CategorizeInput, ctx: ThoughtContext, completion: LlmCompletion): Promise<void> => {
    const parsed = parseCategory(getCompletionText(completion));
    if (!parsed) {
      this.logger.debug(`categorize ${input.conversationId}: model returned no usable category`);
      await this.completeThoughtAction(ctx, 'No category');
      return;
    }
    const category = canonicalizeCategory(parsed, input.knownCategories);

    // Re-check the pin: the user may have organized this conversation while the
    // model was running. Never override a manual choice.
    if (await this.conversations.getGroupPinned(input.conversationId)) {
      await this.completeThoughtAction(ctx, `Skipped (pinned): ${category}`);
      return;
    }

    const updated = await this.conversations.updateGroupName(input.conversationId, category);
    if (!updated) return;
    await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, input.conversationId);
    await this.completeThoughtAction(ctx, category);
    this.logger.log(`categorize ${input.conversationId} -> "${category}"`);
  };

  private async completeThoughtAction(ctx: ThoughtContext, summary: string): Promise<void> {
    if (!ctx.thoughtActionEntryId) return;
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
      summary,
      action: 'final_answer',
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
  }
}

function dedupeCategories(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Extract a single short category label from raw model output. */
export function parseCategory(raw: string): string | null {
  const firstLine = String(raw ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  const clean = firstLine
    .replace(/^\s*category\s*[:\-]\s*/i, '')
    .replace(/["'`*]+/g, '')
    .replace(/[.,;]+$/g, '')
    .trim();
  if (!clean) return null;
  if (!/[a-z0-9]/i.test(clean)) return null;
  return clean.length > 40 ? clean.slice(0, 40).trim() : clean;
}

/** Map a model-produced category onto an existing one when it matches case-insensitively. */
export function canonicalizeCategory(category: string, known: string[]): string {
  const lc = category.toLowerCase();
  const match = known.find((k) => k.toLowerCase() === lc);
  return match ?? category;
}
