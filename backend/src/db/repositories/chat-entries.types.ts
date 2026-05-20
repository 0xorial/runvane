import type { AssistantMessageEntry, UserMessageEntry } from '../../contracts/chatEntry.js';

/** Raw `chat_entries` table row — payload is still a serialised JSON string. */
export type ChatEntryDbRow = {
  id: string;
  conversation_id: string;
  conversation_index: number;
  parent_id: string | null;
  type: string;
  payload_json: string;
  created_at: Date;
};

/**
 * The user-visible message turns — the subset of `ChatEntry` that
 * `listMessages` surfaces (thought scaffolding is excluded). Just the
 * contract entry types; no separate hand-maintained "row" shape.
 */
export type ChatMessageEntry = UserMessageEntry | AssistantMessageEntry;

export type ThoughtStepStatus = 'running' | 'completed' | 'failed' | 'cancelled';
