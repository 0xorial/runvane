import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

export type UserMessageEntryRow = {
  type: 'user-message';
  id: string;
  conversationIndex: number;
  createdAt: string;
  parentId: string | null;
  text: string;
  agentId: string;
  llmProviderId?: string;
  llmModel?: string;
  modelPresetId?: number | null;
};

export type AssistantMessageEntryRow = {
  type: 'assistant-message';
  id: string;
  conversationIndex: number;
  createdAt: string;
  parentId: string | null;
  text: string;
};

export type ChatMessageEntryRow = UserMessageEntryRow | AssistantMessageEntryRow;

type ChatEntryDbRow = {
  id: string;
  conversation_id: string;
  conversation_index: number;
  parent_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
};

@Injectable()
export class ChatEntriesRepo {
  constructor(private readonly prisma: PrismaService) {}

  private async nextConversationIndex(conversationId: string): Promise<number> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX(conversation_index), -1) AS max_idx
       FROM chat_entries
       WHERE conversation_id = ?`,
      conversationId,
    )) as Array<{ max_idx: number | null }>;
    return Number(rows[0]?.max_idx ?? -1) + 1;
  }

  private async getActiveLeafEntryId(conversationId: string): Promise<string | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id
       FROM chat_entries
       WHERE conversation_id = ?
       ORDER BY conversation_index DESC
       LIMIT 1`,
      conversationId,
    )) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  }

  private async touchConversationActivity(conversationId: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE conversations
       SET last_message_at = ?, updated_at = ?
       WHERE id = ?`,
      new Date().toISOString(),
      new Date().toISOString(),
      conversationId,
    );
  }

  async appendUserMessage(
    conversationId: string,
    input: {
      text: string;
      agentId: string;
      llmProviderId?: string;
      llmModel?: string;
      modelPresetId?: number;
    },
  ): Promise<UserMessageEntryRow> {
    const row: UserMessageEntryRow = {
      type: 'user-message',
      id: crypto.randomUUID(),
      conversationIndex: await this.nextConversationIndex(conversationId),
      createdAt: new Date().toISOString(),
      parentId: await this.getActiveLeafEntryId(conversationId),
      text: input.text,
      agentId: input.agentId,
      ...(input.llmProviderId ? { llmProviderId: input.llmProviderId } : {}),
      ...(input.llmModel ? { llmModel: input.llmModel } : {}),
      ...(input.modelPresetId !== undefined ? { modelPresetId: input.modelPresetId } : {}),
    };
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO chat_entries (
         id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      conversationId,
      row.conversationIndex,
      row.parentId,
      row.type,
      JSON.stringify({
        text: row.text,
        agentId: row.agentId,
        ...(row.llmProviderId ? { llmProviderId: row.llmProviderId } : {}),
        ...(row.llmModel ? { llmModel: row.llmModel } : {}),
        ...(row.modelPresetId !== undefined ? { modelPresetId: row.modelPresetId } : {}),
      }),
      row.createdAt,
    );
    await this.touchConversationActivity(conversationId);
    return row;
  }

  async appendAssistantMessage(
    conversationId: string,
    input: { text: string; parentId: string | null },
  ): Promise<AssistantMessageEntryRow> {
    const row: AssistantMessageEntryRow = {
      type: 'assistant-message',
      id: crypto.randomUUID(),
      conversationIndex: await this.nextConversationIndex(conversationId),
      createdAt: new Date().toISOString(),
      parentId: input.parentId,
      text: input.text,
    };
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO chat_entries (
         id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      conversationId,
      row.conversationIndex,
      row.parentId,
      row.type,
      JSON.stringify({ text: row.text }),
      row.createdAt,
    );
    await this.touchConversationActivity(conversationId);
    return row;
  }

  async listMessages(conversationId: string): Promise<ChatMessageEntryRow[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, conversation_id, conversation_index, parent_id, type, payload_json, created_at
       FROM chat_entries
       WHERE conversation_id = ?
       ORDER BY conversation_index ASC`,
      conversationId,
    )) as ChatEntryDbRow[];
    const out: ChatMessageEntryRow[] = [];
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as unknown;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`invalid chat entry payload: ${row.id}`);
      }
      const rec = payload as Record<string, unknown>;
      if (row.type === 'user-message') {
        const agentId = String(rec.agentId ?? '').trim();
        if (!agentId) throw new Error(`invalid user-message payload: missing agentId (${row.id})`);
        out.push({
          type: 'user-message',
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          parentId: row.parent_id,
          text: String(rec.text ?? ''),
          agentId,
          ...(typeof rec.llmProviderId === 'string' && rec.llmProviderId ? { llmProviderId: rec.llmProviderId } : {}),
          ...(typeof rec.llmModel === 'string' && rec.llmModel ? { llmModel: rec.llmModel } : {}),
          ...(typeof rec.modelPresetId === 'number' && Number.isFinite(rec.modelPresetId)
            ? { modelPresetId: rec.modelPresetId }
            : {}),
        });
        continue;
      }
      if (row.type === 'assistant-message') {
        out.push({
          type: 'assistant-message',
          id: row.id,
          conversationIndex: row.conversation_index,
          createdAt: row.created_at,
          parentId: row.parent_id,
          text: String(rec.text ?? ''),
        });
      }
    }
    return out;
  }
}
