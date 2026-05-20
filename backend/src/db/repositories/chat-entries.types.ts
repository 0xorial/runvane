import type { ChatAttachment } from '../../contracts/chatEntry.js';
import type { LlmRef } from '../../contracts/llm.js';

export type UserMessageEntryRow = {
  type: 'user-message';
  id: string;
  conversationIndex: number;
  createdAt: string;
  parentId: string | null;
  text: string;
  agentId: string;
  llm?: LlmRef;
  modelPresetId?: number | null;
  attachments?: ChatAttachment[];
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
export type ThoughtStepStatus = 'running' | 'completed' | 'failed' | 'cancelled';
