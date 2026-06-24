import { Injectable } from '@nestjs/common';
import type { ChatEntry } from '../contracts/chatEntry.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import type { ConversationEntity } from './conversation.entity.js';
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
    const conversations = await Promise.all(rows.map((row) => this.toApiRow(row)));
    return {
      conversations,
      groups: groups.map(toConversationGroupRow),
    };
  }

  async create(input: { title?: string }): Promise<ConversationRow> {
    const created = await this.conversations.create({ title: input.title });
    return this.toApiRow(created);
  }

  async get(conversationId: string, input?: { includeDeleted?: boolean }): Promise<ConversationRow | null> {
    const row = await this.conversations.get(conversationId, { includeDeleted: input?.includeDeleted });
    return row ? this.toApiRow(row) : null;
  }

  async updateTitle(conversationId: string, title: string): Promise<ConversationRow | null> {
    const updated = await this.conversations.updateTitle(conversationId, title);
    return updated ? this.toApiRow(updated) : null;
  }

  async updateGroupId(conversationId: string, groupId: string | null): Promise<ConversationRow | null> {
    const updated = await this.conversations.updateGroupId(conversationId, groupId);
    return updated ? this.toApiRow(updated) : null;
  }

  async updateGroupName(conversationId: string, groupName: string): Promise<ConversationRow | null> {
    const updated = await this.conversations.updateGroupName(conversationId, groupName);
    return updated ? this.toApiRow(updated) : null;
  }

  /** Pin/unpin the conversation's group against the auto-categorizer. */
  async setGroupPinned(conversationId: string, pinned: boolean): Promise<ConversationRow | null> {
    const current = await this.conversations.get(conversationId, { includeDeleted: true });
    if (!current) return null;
    await this.conversations.setGroupPinned(conversationId, pinned);
    return this.toApiRow(current);
  }

  async softDelete(conversationId: string): Promise<ConversationRow | null> {
    const updated = await this.conversations.softDelete(conversationId);
    return updated ? this.toApiRow(updated) : null;
  }

  async undelete(conversationId: string): Promise<ConversationRow | null> {
    const updated = await this.conversations.undelete(conversationId);
    return updated ? this.toApiRow(updated) : null;
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

  async setDefaultViewLeaf(conversationId: string, entryId: string): Promise<ConversationRow | null> {
    await this.chatEntries.setDefaultViewLeaf(conversationId, entryId);
    const updated = await this.conversations.get(conversationId);
    return updated ? this.toApiRow(updated) : null;
  }

  /**
   * Split the subtree rooted at `entryId` out of `sourceConversationId` into a
   * brand-new conversation that records where it was forked from. Returns the
   * new conversation's API row (fork provenance populated). Throws if the entry
   * doesn't belong to the source.
   */
  async split(sourceConversationId: string, entryId: string): Promise<ConversationRow> {
    const source = await this.conversations.get(sourceConversationId);
    if (!source) throw new Error(`conversation not found: ${sourceConversationId}`);
    const rootEntry = await this.chatEntries.getChatEntry(sourceConversationId, entryId);
    if (!rootEntry) throw new Error(`entry not found in conversation: ${entryId}`);

    const target = await this.conversations.create({ title: deriveSplitTitle(rootEntry, source.title) });
    try {
      await this.chatEntries.splitOffSubtree(sourceConversationId, entryId, target.id);
      await Promise.all([
        this.recomputeTokenTotals(sourceConversationId),
        this.recomputeTokenTotals(target.id),
      ]);
    } catch (error) {
      // The move failed; don't leave an orphan empty conversation behind.
      await this.conversations.hardDeleteRegardless(target.id).catch(() => undefined);
      throw error;
    }
    const created = await this.conversations.get(target.id);
    if (!created) throw new Error('split target vanished after creation');
    return this.toApiRow(created);
  }

  private async recomputeTokenTotals(conversationId: string): Promise<void> {
    const totals = await this.chatEntries.rawTokenTotals(conversationId);
    await this.conversations.setTokenTotals(conversationId, totals);
  }

  /**
   * Map a conversation entity to its API row, replacing the stored anchor
   * with the resolved branch leaf. Anchor is only ever written by user
   * actions; resolution gives us the live tip of that branch. Fork provenance
   * lives in columns the Prisma client doesn't know about, so it's read here.
   */
  private async toApiRow(entity: ConversationEntity): Promise<ConversationRow> {
    const [tokenUsageByModel, forkLink, groupPinned] = await Promise.all([
      this.chatEntries.tokenUsageByModel(entity.id),
      this.conversations.getForkLink(entity.id),
      this.conversations.getGroupPinned(entity.id),
    ]);
    const row = toConversationRow(entity, tokenUsageByModel, groupPinned);
    row.defaultViewLeafAnchorId = entity.defaultViewLeafEntryId;
    row.defaultViewLeafEntryId = await this.chatEntries.resolveDefaultViewLeaf(entity.id);
    row.forkedFromConversationId = forkLink.forkedFromConversationId;
    row.forkedFromEntryId = forkLink.forkedFromEntryId;
    row.forkedFromConversationTitle = forkLink.forkedFromConversationTitle;
    return row;
  }
}

/** A readable title for a split-off conversation: the root user message, else a suffix. */
function deriveSplitTitle(rootEntry: ChatEntry, sourceTitle: string): string {
  if (rootEntry.type === 'user-message') {
    const firstLine = (rootEntry.text ?? '').replace(/\s+/g, ' ').trim();
    if (firstLine) return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
  }
  return `${sourceTitle} (split)`;
}
