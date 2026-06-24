import { Injectable } from '@nestjs/common';
import type {
  ConversationEntity,
  ConversationGroupEntity,
  CreateConversationInput,
} from '../../conversations/conversation.entity.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class ConversationsRepo {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeTitle(titleRaw: string | undefined): string {
    const title = String(titleRaw ?? '').trim();
    return title || 'New chat';
  }

  private normalizeGroupName(groupNameRaw: string): string {
    const name = String(groupNameRaw).trim();
    if (!name) throw new Error('group name is required');
    return name;
  }

  async list(options?: { deletedOnly?: boolean }): Promise<ConversationEntity[]> {
    return this.prisma.conversation.findMany({
      where: { isDeleted: options?.deletedOnly === true },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async get(id: string, options?: { includeDeleted?: boolean }): Promise<ConversationEntity | null> {
    const row = await this.prisma.conversation.findUnique({ where: { id } });
    if (!row) return null;
    if (!options?.includeDeleted && row.isDeleted) return null;
    return row;
  }

  async listGroups(): Promise<ConversationGroupEntity[]> {
    return this.prisma.conversationGroup.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async exists(id: string, options?: { includeDeleted?: boolean }): Promise<boolean> {
    const row = await this.get(id, options);
    return row !== null;
  }

  async ensureGroupIdByName(groupNameRaw: string): Promise<string> {
    const name = this.normalizeGroupName(groupNameRaw);
    const existing = await this.prisma.conversationGroup.findUnique({
      where: { name },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.conversationGroup.create({
      data: { id: crypto.randomUUID(), name },
      select: { id: true },
    });
    return created.id;
  }

  async create(input: CreateConversationInput = {}): Promise<ConversationEntity> {
    return this.prisma.conversation.create({
      data: {
        id: crypto.randomUUID(),
        title: this.normalizeTitle(input.title),
      },
    });
  }

  async getById(id: string): Promise<ConversationEntity | null> {
    return this.get(id);
  }

  async updateTitle(id: string, title: string | null): Promise<ConversationEntity | null> {
    const nextTitle = String(title ?? '').trim();
    if (!nextTitle) return null;
    const current = await this.get(id);
    if (!current) return null;
    return this.prisma.conversation.update({
      where: { id },
      data: { title: nextTitle },
    });
  }

  async updateGroupName(id: string, groupNameRaw: string): Promise<ConversationEntity | null> {
    const current = await this.get(id);
    if (!current) return null;
    const groupId = await this.ensureGroupIdByName(groupNameRaw);
    return this.prisma.conversation.update({
      where: { id },
      data: { groupId },
    });
  }

  async updateGroupId(id: string, groupIdRaw: string | null): Promise<ConversationEntity | null> {
    const current = await this.get(id);
    if (!current) return null;
    const normalizedGroupId = typeof groupIdRaw === 'string' ? groupIdRaw.trim() : '';
    const groupId = normalizedGroupId || null;
    if (groupId) {
      const existing = await this.prisma.conversationGroup.findUnique({
        where: { id: groupId },
        select: { id: true },
      });
      if (!existing) throw new Error(`conversation group not found: ${groupId}`);
    }
    return this.prisma.conversation.update({
      where: { id },
      data: { groupId },
    });
  }

  async softDelete(id: string): Promise<ConversationEntity | null> {
    const current = await this.get(id);
    if (!current) return null;
    return this.prisma.conversation.update({
      where: { id },
      data: { isDeleted: true },
    });
  }

  async undelete(id: string): Promise<ConversationEntity | null> {
    const current = await this.get(id, { includeDeleted: true });
    if (!current || !current.isDeleted) return null;
    return this.prisma.conversation.update({
      where: { id },
      data: { isDeleted: false },
    });
  }

  async hardDelete(id: string): Promise<boolean> {
    const current = await this.get(id, { includeDeleted: true });
    if (!current || !current.isDeleted) return false;
    await this.prisma.conversation.delete({
      where: { id },
    });
    return true;
  }

  /** Delete unconditionally (cascades to chat entries). Used to clean up a
   * half-created split target when the subtree move fails. */
  async hardDeleteRegardless(id: string): Promise<void> {
    await this.prisma.conversation.delete({ where: { id } });
  }

  async addTokenUsage(
    id: string,
    tokens: { promptTokens: number; cachedPromptTokens: number; completionTokens: number },
  ): Promise<ConversationEntity> {
    return this.prisma.conversation.update({
      where: { id },
      data: {
        promptTokensTotal: { increment: tokens.promptTokens },
        cachedPromptTokensTotal: { increment: tokens.cachedPromptTokens },
        completionTokensTotal: { increment: tokens.completionTokens },
      },
    });
  }

  /** Overwrite the stored token counters (used after a split moves entries away). */
  async setTokenTotals(
    id: string,
    tokens: { promptTokens: number; cachedPromptTokens: number; completionTokens: number },
  ): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE conversations
       SET prompt_tokens_total = ?, cached_prompt_tokens_total = ?, completion_tokens_total = ?
       WHERE id = ?`,
      Math.max(0, Math.trunc(tokens.promptTokens)),
      Math.max(0, Math.trunc(tokens.cachedPromptTokens)),
      Math.max(0, Math.trunc(tokens.completionTokens)),
      id,
    );
  }

  /**
   * Whether the conversation's group assignment is pinned/locked against the
   * auto-categorizer. Stored in the raw `group_pinned` column (absent from the
   * generated Prisma client), so read/write goes through raw SQL.
   */
  async getGroupPinned(id: string): Promise<boolean> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT group_pinned AS pinned FROM conversations WHERE id = ?`,
      id,
    )) as Array<{ pinned: number | bigint | null }>;
    return Number(rows[0]?.pinned ?? 0) === 1;
  }

  /** Bulk variant for list endpoints: map of conversationId -> pinned. */
  async getGroupPinnedByIds(ids: string[]): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, group_pinned AS pinned FROM conversations WHERE id IN (${placeholders})`,
      ...ids,
    )) as Array<{ id: string; pinned: number | bigint | null }>;
    for (const row of rows) map.set(row.id, Number(row.pinned ?? 0) === 1);
    return map;
  }

  async setGroupPinned(id: string, pinned: boolean): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE conversations SET group_pinned = ? WHERE id = ?`,
      pinned ? 1 : 0,
      id,
    );
  }

  /**
   * Fork provenance for a conversation. These columns are written by the split
   * flow and aren't part of the generated Prisma client, so they're read with
   * raw SQL. The source title is resolved live (null if the source is gone).
   */
  async getForkLink(id: string): Promise<{
    forkedFromConversationId: string | null;
    forkedFromEntryId: string | null;
    forkedFromConversationTitle: string | null;
  }> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT c.forked_from_conversation_id AS fromId,
              c.forked_from_entry_id AS fromEntry,
              src.title AS fromTitle
       FROM conversations c
       LEFT JOIN conversations src ON src.id = c.forked_from_conversation_id
       WHERE c.id = ?`,
      id,
    )) as Array<{ fromId: string | null; fromEntry: string | null; fromTitle: string | null }>;
    const row = rows[0];
    return {
      forkedFromConversationId: row?.fromId ?? null,
      forkedFromEntryId: row?.fromEntry ?? null,
      forkedFromConversationTitle: row?.fromTitle ?? null,
    };
  }
}
