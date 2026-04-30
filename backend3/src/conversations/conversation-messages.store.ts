import { Injectable } from '@nestjs/common';

export type StoredChatMessageEntry =
  | {
      id: string;
      conversationIndex: number;
      createdAt: string;
      parentId: string | null;
      type: 'user-message';
      text: string;
      agentId: string;
      llmProviderId?: string;
      llmModel?: string;
      modelPresetId?: number | null;
    }
  | {
      id: string;
      conversationIndex: number;
      createdAt: string;
      parentId: string | null;
      type: 'assistant-message';
      text: string;
    };

@Injectable()
export class ConversationMessagesStore {
  private readonly byConversationId = new Map<string, StoredChatMessageEntry[]>();

  list(conversationId: string): StoredChatMessageEntry[] {
    return [...(this.byConversationId.get(conversationId) ?? [])];
  }

  appendUserMessage(
    conversationId: string,
    input: {
      text: string;
      agentId: string;
      llmProviderId?: string;
      llmModel?: string;
      modelPresetId?: number;
    },
  ): StoredChatMessageEntry & { type: 'user-message' } {
    const entries = this.byConversationId.get(conversationId) ?? [];
    const row: StoredChatMessageEntry & { type: 'user-message' } = {
      id: crypto.randomUUID(),
      conversationIndex: entries.length,
      createdAt: new Date().toISOString(),
      parentId: entries.at(-1)?.id ?? null,
      type: 'user-message',
      text: input.text,
      agentId: input.agentId,
      ...(input.llmProviderId ? { llmProviderId: input.llmProviderId } : {}),
      ...(input.llmModel ? { llmModel: input.llmModel } : {}),
      ...(input.modelPresetId !== undefined ? { modelPresetId: input.modelPresetId } : {}),
    };
    entries.push(row);
    this.byConversationId.set(conversationId, entries);
    return row;
  }

  appendAssistantMessage(conversationId: string, input: { text: string; parentId: string }): StoredChatMessageEntry {
    const entries = this.byConversationId.get(conversationId) ?? [];
    const row: StoredChatMessageEntry = {
      id: crypto.randomUUID(),
      conversationIndex: entries.length,
      createdAt: new Date().toISOString(),
      parentId: input.parentId,
      type: 'assistant-message',
      text: input.text,
    };
    entries.push(row);
    this.byConversationId.set(conversationId, entries);
    return row;
  }
}
