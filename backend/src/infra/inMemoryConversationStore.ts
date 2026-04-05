import type { ChatMessageEntry } from "../routes/conversations.types.js";

type ConversationState = {
  messages: ChatMessageEntry[];
};

export class InMemoryConversationStore {
  private readonly conversations = new Map<string, ConversationState>();

  private ensure(conversationId: string): ConversationState {
    const cur = this.conversations.get(conversationId);
    if (cur) return cur;
    const next: ConversationState = { messages: [] };
    this.conversations.set(conversationId, next);
    return next;
  }

  appendUserMessage(conversationId: string, text: string): ChatMessageEntry {
    const row: ChatMessageEntry = {
      type: "user-message",
      id: crypto.randomUUID(),
      conversationIndex: this.ensure(conversationId).messages.length,
      text,
      createdAt: new Date().toISOString(),
    };
    this.ensure(conversationId).messages.push(row);
    return row;
  }

  appendAssistantMessage(conversationId: string, text: string): ChatMessageEntry {
    const row: ChatMessageEntry = {
      type: "assistant-message",
      id: crypto.randomUUID(),
      conversationIndex: this.ensure(conversationId).messages.length,
      text,
      createdAt: new Date().toISOString(),
    };
    this.ensure(conversationId).messages.push(row);
    return row;
  }

  listMessages(conversationId: string): ChatMessageEntry[] {
    return [...this.ensure(conversationId).messages];
  }
}
