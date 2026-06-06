import type { NormalizedImportConversation, NormalizedImportMessage } from './types.js';

type OpenAiSimpleConversation = {
  title?: string;
  messages?: Array<{ role?: string; content?: string }>;
};

type OpenAiMappingNode = {
  id?: string;
  message?: { author?: { role?: string }; content?: { parts?: Array<{ text?: string }> } };
  children?: string[];
};

type OpenAiMappingConversation = {
  title?: string;
  mapping?: Record<string, OpenAiMappingNode>;
};

function normalizeRole(raw: string | undefined): NormalizedImportMessage['role'] | null {
  if (raw === 'user' || raw === 'assistant') return raw;
  return null;
}

function parseSimpleConversation(row: OpenAiSimpleConversation): NormalizedImportConversation | null {
  const messages: NormalizedImportMessage[] = [];
  for (const message of row.messages ?? []) {
    const role = normalizeRole(message.role);
    const content = String(message.content ?? '').trim();
    if (!role || !content) continue;
    messages.push({ role, content });
  }
  if (messages.length === 0) return null;
  return { title: String(row.title ?? 'Imported chat').trim() || 'Imported chat', messages };
}

function walkOpenAiMapping(conversation: OpenAiMappingConversation): NormalizedImportConversation | null {
  const mapping = conversation.mapping;
  if (!mapping) return null;
  const root = Object.values(mapping).find((node) => node.message?.author?.role === 'user') ??
    Object.values(mapping)[0];
  if (!root?.id) return null;

  const messages: NormalizedImportMessage[] = [];
  const seen = new Set<string>();
  const queue = [root.id];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = mapping[id];
    if (!node) continue;
    const role = normalizeRole(node.message?.author?.role);
    const content = String(node.message?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '').trim();
    if (role && content) messages.push({ role, content });
    for (const childId of node.children ?? []) queue.push(childId);
  }
  if (messages.length === 0) return null;
  return { title: String(conversation.title ?? 'Imported chat').trim() || 'Imported chat', messages };
}

export function parseOpenAiExport(raw: unknown): NormalizedImportConversation[] {
  if (!Array.isArray(raw)) throw new Error('OpenAI import: expected top-level array');
  const out: NormalizedImportConversation[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const simple = parseSimpleConversation(row as OpenAiSimpleConversation);
    if (simple) {
      out.push(simple);
      continue;
    }
    const mapped = walkOpenAiMapping(row as OpenAiMappingConversation);
    if (mapped) out.push(mapped);
  }
  if (out.length === 0) throw new Error('OpenAI import: no conversations parsed');
  return out;
}
