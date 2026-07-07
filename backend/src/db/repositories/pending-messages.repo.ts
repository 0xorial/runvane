import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { PostConversationMessageDto } from '../../conversations/dto/post-conversation-message.dto.js';

/**
 * Durable FIFO of messages accepted while a run was in flight (the "enqueue"
 * path). Rows store the original {@link PostConversationMessageDto} verbatim —
 * draining replays it through the exact same posting flow. Persisted so a
 * backend restart cannot drop text the user already typed; the conversation
 * processor drains leftovers on boot.
 */
@Injectable()
export class PendingMessagesRepo {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(conversationId: string, dto: PostConversationMessageDto): Promise<void> {
    await this.prisma.pendingMessage.create({
      data: {
        conversationId,
        clientRequestId: dto.clientRequestId ?? null,
        dtoJson: JSON.parse(JSON.stringify(dto)),
      },
    });
  }

  /** Remove and return the oldest queued message, or null when the queue is empty. */
  async shiftOldest(conversationId: string): Promise<PostConversationMessageDto | null> {
    const row = await this.prisma.pendingMessage.findFirst({
      where: { conversationId },
      orderBy: { seq: 'asc' },
    });
    if (!row) return null;
    await this.prisma.pendingMessage.delete({ where: { seq: row.seq } });
    return toDto(row.dtoJson);
  }

  /** Drop one queued message by its clientRequestId. True if a row was removed. */
  async removeByClientRequestId(conversationId: string, clientRequestId: string): Promise<boolean> {
    const res = await this.prisma.pendingMessage.deleteMany({
      where: { conversationId, clientRequestId },
    });
    return res.count > 0;
  }

  async list(conversationId: string): Promise<Array<{ clientRequestId: string | null; dto: PostConversationMessageDto }>> {
    const rows = await this.prisma.pendingMessage.findMany({
      where: { conversationId },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r) => ({ clientRequestId: r.clientRequestId, dto: toDto(r.dtoJson) }));
  }

  /** Conversations with queued messages — the boot drain's worklist. */
  async conversationIdsWithPending(): Promise<string[]> {
    const rows = await this.prisma.pendingMessage.findMany({
      select: { conversationId: true },
      distinct: ['conversationId'],
    });
    return rows.map((r) => r.conversationId);
  }
}

function toDto(raw: unknown): PostConversationMessageDto {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return parsed as PostConversationMessageDto;
}
