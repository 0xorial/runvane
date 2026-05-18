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
}
