import type { NormalizedImportConversation, NormalizedImportMessage } from './types.js';

type ClaudeContentBlock = {
  type?: string;
  text?: string;
};

type ClaudeMessage = {
  sender?: string;
  text?: string;
  content?: ClaudeContentBlock[] | string;
};

type ClaudeConversation = {
  name?: string;
  title?: string;
  chat_messages?: ClaudeMessage[];
};

function normalizeClaudeRole(raw: string | undefined): NormalizedImportMessage['role'] | null {
  const role = String(raw ?? '').trim().toLowerCase();
  if (role === 'human' || role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  return null;
}

function claudeMessageText(message: ClaudeMessage): string {
  const direct = String(message.text ?? '').trim();
  if (direct) return direct;
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type !== 'text') continue;
    const text = String(block.text ?? '').trim();
    if (text) parts.push(text);
  }
  return parts.join('\n').trim();
}

function parseClaudeConversation(row: ClaudeConversation): NormalizedImportConversation | null {
  const messages: NormalizedImportMessage[] = [];
  for (const message of row.chat_messages ?? []) {
    const role = normalizeClaudeRole(message.sender);
    const content = claudeMessageText(message);
    if (!role || !content) continue;
    messages.push({ role, content });
  }
  if (messages.length === 0) return null;
  const title = String(row.name ?? row.title ?? 'Imported Claude chat').trim() || 'Imported Claude chat';
  return { title, messages };
}

export function parseClaudeExport(raw: unknown): NormalizedImportConversation[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { conversations?: unknown }).conversations)
      ? (raw as { conversations: ClaudeConversation[] }).conversations
      : null;
  if (!rows) throw new Error('Claude import: expected array or { conversations: [] }');

  const out: NormalizedImportConversation[] = [];
  for (const row of rows) {
    const parsed = parseClaudeConversation(row);
    if (parsed) out.push(parsed);
  }
  if (out.length === 0) throw new Error('Claude import: no conversations parsed');
  return out;
}
