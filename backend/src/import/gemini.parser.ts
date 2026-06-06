import type { NormalizedImportConversation, NormalizedImportMessage } from './types.js';

type GeminiConversation = {
  title?: string;
  messages?: Array<{ role?: string; author?: string; content?: string; text?: string }>;
};

function normalizeGeminiRole(raw: string | undefined): NormalizedImportMessage['role'] | null {
  const role = String(raw ?? '').trim().toLowerCase();
  if (role === 'user') return 'user';
  if (role === 'model' || role === 'assistant') return 'assistant';
  return null;
}

export function parseGeminiExport(raw: unknown): NormalizedImportConversation[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { conversations?: unknown }).conversations)
      ? (raw as { conversations: GeminiConversation[] }).conversations
      : null;
  if (!rows) throw new Error('Gemini import: expected array or { conversations: [] }');

  const out: NormalizedImportConversation[] = [];
  for (const row of rows) {
    const messages: NormalizedImportMessage[] = [];
    for (const message of row.messages ?? []) {
      const role = normalizeGeminiRole(message.role ?? message.author);
      const content = String(message.content ?? message.text ?? '').trim();
      if (!role || !content) continue;
      messages.push({ role, content });
    }
    if (messages.length === 0) continue;
    out.push({
      title: String(row.title ?? 'Imported Gemini chat').trim() || 'Imported Gemini chat',
      messages,
    });
  }
  if (out.length === 0) throw new Error('Gemini import: no conversations parsed');
  return out;
}
