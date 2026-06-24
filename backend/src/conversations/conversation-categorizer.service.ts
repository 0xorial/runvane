import { Injectable, Logger } from '@nestjs/common';
import {
  CONVERSATION_CATEGORIZATION_SETTING_KEY,
  normalizeConversationCategorizationConfig,
  type ConversationCategorizationConfig,
} from '../contracts/conversation-config.js';
import { AppSettingsRepo } from '../db/repositories/app-settings.repo.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { LlmProviderSettingsRepo } from '../db/repositories/llm-provider-settings.repo.js';
import { LlmProviderRegistry } from '../llmProviders/registry.js';
import { getCompletionText, textMessage } from '../llmProviders/types.js';
import type { LlmRequest } from '../llmProviders/types.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated } from '../sse/sse-helpers.js';

/** Fixed reminder appended to every categorization prompt. Kept stable (and
 *  prompt-independent) so deterministic test stubs can recognise the request. */
const CATEGORIZATION_FORMAT_REMINDER = 'Reply with ONLY the category name on a single line.';

const CATEGORIZE_TIMEOUT_MS = 30_000;

@Injectable()
export class ConversationCategorizerService {
  private readonly logger = new Logger(ConversationCategorizerService.name);

  constructor(
    private readonly appSettings: AppSettingsRepo,
    private readonly conversations: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly llmProviders: LlmProviderRegistry,
    private readonly hub: SseHubService,
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
   * Fire-and-forget categorization: never throws, logs and moves on. Use from
   * request/run paths so categorization can't break message posting.
   */
  categorizeInBackground(conversationId: string): void {
    void this.categorizeConversation(conversationId).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`categorize ${conversationId} failed: ${detail}`);
    });
  }

  /**
   * Classify a conversation and assign it to a group (creating the group when
   * the category is new). No-op when disabled, when the conversation's group is
   * pinned, when there's no user message yet, or when no LLM provider resolves.
   */
  async categorizeConversation(conversationId: string): Promise<{ category: string } | null> {
    const config = await this.getConfig();
    if (!config.enabled) return null;

    if (await this.conversations.getGroupPinned(conversationId)) return null;

    const conversation = await this.conversations.get(conversationId);
    if (!conversation) return null;

    const messages = await this.chatEntries.listMessages(conversationId);
    const firstUser = messages.find((entry) => entry.type === 'user-message');
    const firstUserText = firstUser && 'text' in firstUser ? String(firstUser.text ?? '').trim() : '';
    if (!firstUserText) return null;

    const groups = await this.conversations.listGroups();
    const knownCategories = dedupeCategories([...config.seedCategories, ...groups.map((g) => g.name)]);

    const completionText = await this.runQuery(config, conversation.title, firstUserText, knownCategories);
    if (completionText == null) return null;

    const parsed = parseCategory(completionText);
    if (!parsed) {
      this.logger.debug(`categorize ${conversationId}: model returned no usable category`);
      return null;
    }
    const category = canonicalizeCategory(parsed, knownCategories);

    // Re-check the pin: the user may have organized this conversation while the
    // model was running. Never override a manual choice.
    if (await this.conversations.getGroupPinned(conversationId)) return null;

    const updated = await this.conversations.updateGroupName(conversationId, category);
    if (!updated) return null;
    await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, conversationId);
    this.logger.log(`categorize ${conversationId} -> "${category}"`);
    return { category };
  }

  private buildRequest(
    config: ConversationCategorizationConfig,
    title: string,
    firstUserText: string,
    knownCategories: string[],
  ): LlmRequest {
    const categoryList = knownCategories.length > 0 ? knownCategories.join(', ') : '(none yet)';
    const system = [
      config.prompt,
      '',
      `Existing categories (prefer one of these): ${categoryList}.`,
      CATEGORIZATION_FORMAT_REMINDER,
    ].join('\n');
    const titleLine = title && title !== 'New chat' ? `Title: ${title}\n` : '';
    return {
      messages: [
        textMessage('system', system),
        textMessage('user', `${titleLine}First message:\n${firstUserText}`),
        // Mirror auto-title: prefill a closed thinking block to suppress local
        // models' reasoning phase so the response is just the category.
        { role: 'assistant', parts: [{ kind: 'text', text: '<think></think>\n\n' }] },
      ],
    };
  }

  private async runQuery(
    config: ConversationCategorizationConfig,
    title: string,
    firstUserText: string,
    knownCategories: string[],
  ): Promise<string | null> {
    const doc = await this.llmProviderSettings.getDocument();
    const cfg = doc.llm_configuration;
    const providerId = (cfg.title_provider_id || cfg.provider_id || '').trim();
    const model = (cfg.title_model_name || cfg.model_name || '').trim();
    if (!providerId || !model) return null;

    const provider = this.llmProviders.get(providerId);
    if (!provider) {
      this.logger.debug(`categorize: unknown llm provider "${providerId}"`);
      return null;
    }
    const settings = await this.llmProviderSettings.getProviderSettings(providerId);
    if (!settings) {
      this.logger.debug(`categorize: no settings for provider "${providerId}"`);
      return null;
    }

    const request = this.buildRequest(config, title, firstUserText, knownCategories);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATEGORIZE_TIMEOUT_MS);
    try {
      const completion = await provider.streamCompletion(settings, model, request, () => {}, controller.signal);
      return getCompletionText(completion);
    } finally {
      clearTimeout(timer);
    }
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
