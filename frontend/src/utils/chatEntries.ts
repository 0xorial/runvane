import type { ChatEntry } from "../protocol/chatEntry";

export const defaultChatEntries: ChatEntry[] = [];

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === "object" && !Array.isArray(x);
}

/** API boundary: server shapes are trusted only as far as `type` + ids. */
export function normalizeChatEntry(raw: unknown, index: number): ChatEntry {
  if (!isRecord(raw)) {
    return {
      type: "assistant-message",
      id: crypto.randomUUID(),
      conversationIndex: index,
      createdAt: new Date().toISOString(),
      text: "",
    };
  }

  const id = raw.id != null ? String(raw.id) : crypto.randomUUID();

  if (typeof raw.type === "string") {
    return { ...raw, id } as ChatEntry;
  }

  const role = typeof raw.role === "string" ? raw.role : "";
  const text = typeof raw.text === "string" ? raw.text : "";
  const createdAt =
    typeof raw.createdAt === "string"
      ? raw.createdAt
      : typeof raw.created_at === "string"
      ? raw.created_at
      : new Date().toISOString();

  if (role === "user") {
    const agentIdRaw =
      typeof raw.agentId === "string"
        ? raw.agentId
        : typeof raw.agent_id === "string"
        ? raw.agent_id
        : "";
    const agentId = agentIdRaw.trim();
    if (!agentId) {
      throw new Error(
        "normalizeChatEntry failed: role=user entry missing required agentId"
      );
    }
    return {
      type: "user-message",
      id,
      conversationIndex: index,
      createdAt,
      text,
      agentId,
    };
  }

  return {
    type: "assistant-message",
    id,
    conversationIndex: index,
    createdAt,
    text,
  };
}

export function mapApiMessagesToChatEntries(list: unknown): ChatEntry[] {
  if (!Array.isArray(list) || list.length === 0) return defaultChatEntries;
  return list.map((x, index) => normalizeChatEntry(x, index));
}
