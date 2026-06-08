import type { NormalizedImportConversation, NormalizedImportMessage } from './types.js';

type GrokResponseRow = {
  sender?: string;
  message?: string;
  response?: { sender?: string; message?: string };
};

type GrokConversationRow = {
  conversation?: { title?: string; name?: string };
  title?: string;
  responses?: GrokResponseRow[];
};

function normalizeGrokRole(raw: string | undefined): NormalizedImportMessage['role'] | null {
  const role = String(raw ?? '').trim().toLowerCase();
  if (role === 'human' || role === 'user') return 'user';
  if (role === 'assistant' || role === 'grok') return 'assistant';
  return null;
}

function unwrapGrokResponse(row: GrokResponseRow): { sender?: string; message?: string } {
  if (row.response && typeof row.response === 'object') return row.response;
  return row;
}

function parseGrokConversation(row: GrokConversationRow): NormalizedImportConversation | null {
  const messages: NormalizedImportMessage[] = [];
  for (const rawResponse of row.responses ?? []) {
    const response = unwrapGrokResponse(rawResponse);
    const role = normalizeGrokRole(response.sender);
    const content = String(response.message ?? '').trim();
    if (!role || !content) continue;
    messages.push({ role, content });
  }
  if (messages.length === 0) return null;
  const title =
    String(row.conversation?.title ?? row.conversation?.name ?? row.title ?? 'Imported Grok chat').trim() ||
    'Imported Grok chat';
  return { title, messages };
}

export function parseGrokExport(raw: unknown): NormalizedImportConversation[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { conversations?: unknown }).conversations)
      ? (raw as { conversations: GrokConversationRow[] }).conversations
      : null;
  if (!rows) throw new Error('Grok import: expected array or { conversations: [] }');

  const out: NormalizedImportConversation[] = [];
  for (const row of rows) {
    const parsed = parseGrokConversation(row);
    if (parsed) out.push(parsed);
  }
  if (out.length === 0) throw new Error('Grok import: no conversations parsed');
  return out;
}
