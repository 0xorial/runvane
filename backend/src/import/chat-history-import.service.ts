import { Injectable } from '@nestjs/common';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { parseGeminiExport } from './gemini.parser.js';
import { parseOpenAiExport } from './openai.parser.js';
import type { ImportResult, NormalizedImportConversation } from './types.js';

@Injectable()
export class ChatHistoryImportService {
  constructor(
    private readonly conversations: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  importOpenAi(raw: unknown, agentId: string): Promise<ImportResult> {
    return this.importParsed(parseOpenAiExport(raw), agentId);
  }

  importGemini(raw: unknown, agentId: string): Promise<ImportResult> {
    return this.importParsed(parseGeminiExport(raw), agentId);
  }

  private async importParsed(rows: NormalizedImportConversation[], agentId: string): Promise<ImportResult> {
    const conversationIds: string[] = [];
    for (const row of rows) {
      const created = await this.conversations.create({ title: row.title });
      let parentId: string | null = null;
      for (const message of row.messages) {
        if (message.role === 'user') {
          const entry = await this.chatEntries.appendUserMessage(created.id, {
            text: message.content,
            agentId,
            parentId,
          });
          parentId = entry.id;
          continue;
        }
        const entry = await this.chatEntries.appendAssistantMessage(created.id, {
          text: message.content,
          parentId,
        });
        parentId = entry.id;
      }
      if (parentId) await this.chatEntries.setDefaultViewLeaf(created.id, parentId);
      conversationIds.push(created.id);
    }
    return { imported: conversationIds.length, conversationIds };
  }
}
