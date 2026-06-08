import { Injectable } from '@nestjs/common';
import type { ChatEntry } from '../../../contracts/chatEntry.js';
import { ChatEntriesRepo } from '../../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../../db/repositories/conversations.repo.js';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { zerialize } from 'zodex';
import {
  assertConversationAccess,
  capChatEntries,
  resolveTargetConversationId,
  toConversationApiRow,
} from './conversations-access.js';
import {
  conversationsToolParamsSchema,
  parseConversationsToolParams,
  type ConversationsToolParams,
} from './params.js';
import { ConversationsToolRulesSchema, parseConversationsToolRules, type ConversationsToolRules } from './rules.js';

@Injectable()
export class ConversationsTool extends BaseTool<ConversationsToolParams, ConversationsToolRules> {
  constructor(
    private readonly conversations: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
  ) {
    super();
  }

  getName(): string {
    return 'conversations';
  }

  getAiDescription(): string {
    return (
      'Read chat history via the same data as the HTTP API. ' +
      'Operations: list_conversations, get_conversation(conversation_id?), list_messages(conversation_id?, all?). ' +
      'Omit conversation_id to use the active chat. Cross-chat access requires allow_other_conversations in tool rules. ' +
      'For agents, tools catalog, or tasks use the api tool.'
    );
  }

  getHumanDescription(): string {
    return 'List conversations and read chat messages.';
  }

  getParamsSchema(): unknown {
    return conversationsToolParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(ConversationsToolRulesSchema);
  }

  getDefaultRules(): ConversationsToolRules {
    return {
      allowed: 'always',
      allow_other_conversations: false,
      max_messages: 500,
    };
  }

  parseParams(raw: unknown): ConversationsToolParams {
    return parseConversationsToolParams(raw);
  }

  parseRules(raw: unknown): ConversationsToolRules {
    return parseConversationsToolRules(raw);
  }

  evaluatePermission(context: ToolPermissionContext<ConversationsToolRules>): RuleEvaluationResult[] {
    const allowedRule = context.agentToolConfig.rules.allowed;
    const permission = allowedRule === 'always' ? 'allow' : allowedRule === 'never' ? 'forbid' : 'ask_user';
    return [{ ruleName: 'allowed', permission, detail: `Rule allowed='${allowedRule}'.` }];
  }

  async runTool(params: ConversationsToolParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseConversationsToolRules(context.toolRules ?? this.getDefaultRules());

    switch (params.operation) {
      case 'list_conversations':
        return this.listConversations(params, rules);
      case 'get_conversation':
        return this.getConversation(params, context, rules);
      case 'list_messages':
        return this.listMessages(params, context, rules);
      default:
        throw new Error(`conversations: unsupported operation ${params.operation as string}`);
    }
  }

  private async listConversations(params: ConversationsToolParams, rules: ConversationsToolRules): Promise<unknown> {
    if (!rules.allow_other_conversations) {
      throw new Error('conversations.list_conversations requires allow_other_conversations=true in tool rules');
    }
    const rows = await this.conversations.list({ deletedOnly: params.deleted_only === true });
    const conversations = await Promise.all(
      rows.map((row) => toConversationApiRow(row, (id) => this.chatEntries.resolveDefaultViewLeaf(id))),
    );
    return { conversations, count: conversations.length };
  }

  private async getConversation(
    params: ConversationsToolParams,
    context: ToolRunContext,
    rules: ConversationsToolRules,
  ): Promise<unknown> {
    const targetId = resolveTargetConversationId(params.conversation_id, context.conversationId);
    assertConversationAccess(targetId, context.conversationId, rules);
    const entity = await this.conversations.get(targetId, { includeDeleted: true });
    if (!entity) throw new Error(`conversations: conversation not found: ${targetId}`);
    const conversation = await toConversationApiRow(entity, (id) => this.chatEntries.resolveDefaultViewLeaf(id));
    return { conversation };
  }

  private async listMessages(
    params: ConversationsToolParams,
    context: ToolRunContext,
    rules: ConversationsToolRules,
  ): Promise<unknown> {
    const targetId = resolveTargetConversationId(params.conversation_id, context.conversationId);
    assertConversationAccess(targetId, context.conversationId, rules);
    const entity = await this.conversations.get(targetId);
    if (!entity) throw new Error(`conversations: conversation not found: ${targetId}`);

    const entries = await this.chatEntries.listChatEntries(targetId, { all: params.all === true });
    const { messages, truncated } = capChatEntries(entries, rules.max_messages);
    return {
      conversationId: targetId,
      messages: messages as ChatEntry[],
      count: messages.length,
      truncated,
      all: params.all === true,
    };
  }
}
