import { Injectable } from '@nestjs/common';
import type { ChatEntry } from '../contracts/chatEntry.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import {
  toConversationGroupRow,
  toConversationRow,
  type ConversationGroupRow,
  type ConversationRow,
  type GetConversationsResponse,
} from './conversations.api.js';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversations: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  async list(input: { deletedOnly?: boolean }): Promise<GetConversationsResponse> {
    const [rows, groups] = await Promise.all([
      this.conversations.list({ deletedOnly: input.deletedOnly }),
      this.conversations.listGroups(),
    ]);
    return {
      conversations: rows.map(toConversationRow),
      groups: groups.map(toConversationGroupRow),
    };
  }

  async create(input: { title?: string }): Promise<ConversationRow> {
    const created = await this.conversations.create({ title: input.title });
    return toConversationRow(created);
  }

  async get(conversationId: string, input?: { includeDeleted?: boolean }): Promise<ConversationRow | null> {
    const row = await this.conversations.get(conversationId, { includeDeleted: input?.includeDeleted });
    return row ? toConversationRow(row) : null;
  }

  async updateTitle(conversationId: string, title: string): Promise<ConversationRow | null> {
    const updated = await this.conversations.updateTitle(conversationId, title);
    return updated ? toConversationRow(updated) : null;
  }

  async updateGroupId(conversationId: string, groupId: string | null): Promise<ConversationRow | null> {
    const updated = await this.conversations.updateGroupId(conversationId, groupId);
    return updated ? toConversationRow(updated) : null;
  }

  async updateGroupName(conversationId: string, groupName: string): Promise<ConversationRow | null> {
    const updated = await this.conversations.updateGroupName(conversationId, groupName);
    return updated ? toConversationRow(updated) : null;
  }

  async softDelete(conversationId: string): Promise<ConversationRow | null> {
    const updated = await this.conversations.softDelete(conversationId);
    return updated ? toConversationRow(updated) : null;
  }

  async undelete(conversationId: string): Promise<ConversationRow | null> {
    const updated = await this.conversations.undelete(conversationId);
    return updated ? toConversationRow(updated) : null;
  }

  async hardDelete(conversationId: string): Promise<boolean> {
    return this.conversations.hardDelete(conversationId);
  }

  async listGroups(): Promise<ConversationGroupRow[]> {
    const groups = await this.conversations.listGroups();
    return groups.map(toConversationGroupRow);
  }

  async listChatEntries(conversationId: string, opts: { all?: boolean } = {}): Promise<ChatEntry[]> {
    return this.chatEntries.listChatEntries(conversationId, opts);
  }

  async setActiveLeaf(conversationId: string, entryId: string): Promise<ConversationRow | null> {
    await this.chatEntries.setActiveLeafEntry(conversationId, entryId);
    const updated = await this.conversations.get(conversationId);
    return updated ? toConversationRow(updated) : null;
  }
}
