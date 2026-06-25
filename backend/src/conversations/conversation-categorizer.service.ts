import { Injectable } from '@nestjs/common';
import {
  CONVERSATION_CATEGORIZATION_SETTING_KEY,
  normalizeConversationCategorizationConfig,
  type ConversationCategorizationConfig,
} from '../contracts/conversation-config.js';
import { AppSettingsRepo } from '../db/repositories/app-settings.repo.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';

/**
 * Owns the auto-categorization config and the gate that decides whether a
 * conversation should be categorized. The categorization LLM call itself is a
 * first-class thought (see `CategorizeThoughtTypeProvider`); the
 * conversation-processor starts that thought — on the run for the first
 * message, or standalone when a pinned chat is unlocked.
 */
@Injectable()
export class ConversationCategorizerService {
  constructor(
    private readonly appSettings: AppSettingsRepo,
    private readonly conversations: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  async getConfig(): Promise<ConversationCategorizationConfig> {
    const raw = await this.appSettings.getJson(CONVERSATION_CATEGORIZATION_SETTING_KEY);
    return normalizeConversationCategorizationConfig(raw);
  }

  async setConfig(config: ConversationCategorizationConfig): Promise<ConversationCategorizationConfig> {
    await this.appSettings.setJson(CONVERSATION_CATEGORIZATION_SETTING_KEY, config);
    return config;
  }

  /**
   * Whether a categorize thought should run: the feature is enabled, the
   * conversation's group isn't pinned, and there's a first user message to
   * classify from. Cheap enough to call on the message-post path.
   */
  async shouldCategorize(conversationId: string): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.enabled) return false;
    if (await this.conversations.getGroupPinned(conversationId)) return false;
    const messages = await this.chatEntries.listMessages(conversationId);
    const firstUser = messages.find((entry) => entry.type === 'user-message');
    const firstUserText = firstUser && 'text' in firstUser ? String(firstUser.text ?? '').trim() : '';
    return firstUserText.length > 0;
  }
}
