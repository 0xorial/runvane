export const PROBE_MESSAGE = 'what is the time?';

/** True when INTEGRATION_LIVE_LLM=1 (real provider; slow). Default integration uses stub. */
export function integrationUsesLiveLlm(): boolean {
  return process.env.INTEGRATION_LIVE_LLM === '1';
}

export const INTEGRATION_LLM_TIMEOUT_MS = Number(
  process.env.INTEGRATION_LLM_TIMEOUT_MS ?? (integrationUsesLiveLlm() ? 45_000 : 2_000),
);

const POLL_MS = 10;

export type ChatEntryRow = {
  id: string;
  type: string;
  conversationIndex: number;
  parentId: string | null;
  text?: string;
  title?: string;
  toolId?: string;
};

export type AgentRow = {
  id: string;
  is_default?: boolean;
};

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getDefaultAgentId(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/agents`);
  if (!res.ok) throw new Error(`GET /api/agents failed: ${res.status}`);
  const agents = (await res.json()) as AgentRow[];
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('integration setup: no agents in database');
  }
  const agent = agents.find((row) => row.is_default) ?? agents[0];
  if (!agent?.id) throw new Error('integration setup: agent row missing id');
  return agent.id;
}

export async function createConversation(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'integration test' }),
  });
  if (!res.ok) throw new Error(`POST /api/conversations failed: ${res.status}`);
  const row = (await res.json()) as { id?: string };
  if (!row.id) throw new Error('POST /api/conversations: missing id');
  return row.id;
}

export async function postProbeMessage(baseUrl: string, conversationId: string, agentId: string): Promise<void> {
  await postConversationMessage(baseUrl, conversationId, agentId, PROBE_MESSAGE);
}

export async function postConversationMessage(
  baseUrl: string,
  conversationId: string,
  agentId: string,
  message: string,
  options?: { steer?: boolean; enqueue?: boolean; parentId?: string | null; clientRequestId?: string },
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      agentId,
      ...(options?.steer ? { steer: true } : {}),
      ...(options?.enqueue ? { enqueue: true } : {}),
      ...(options?.clientRequestId ? { clientRequestId: options.clientRequestId } : {}),
      ...(options?.parentId !== undefined ? { parentId: options.parentId } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`POST /api/conversations/:id/messages failed: ${res.status} ${detail}`);
  }
}

export async function listAllMessages(baseUrl: string, conversationId: string): Promise<ChatEntryRow[]> {
  const res = await fetch(
    `${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages?all=1`,
  );
  if (!res.ok) throw new Error(`GET messages failed: ${res.status}`);
  const rows = (await res.json()) as ChatEntryRow[];
  if (!Array.isArray(rows)) throw new Error('GET messages: expected array');
  return rows;
}

export async function waitForProbeCompletion(
  baseUrl: string,
  conversationId: string,
  timeoutMs = INTEGRATION_LLM_TIMEOUT_MS,
): Promise<ChatEntryRow[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entries = await listAllMessages(baseUrl, conversationId);
    const sorted = [...entries].sort((a, b) => a.conversationIndex - b.conversationIndex);
    const toolIdx = sorted.findIndex((entry) => entry.type === 'tool-invocation');
    if (toolIdx < 0) {
      await sleep(POLL_MS);
      continue;
    }
    const finalAssistant = [...sorted]
      .slice(toolIdx + 1)
      .reverse()
      .find((entry) => entry.type === 'assistant-message' && String(entry.text || '').trim().length > 0);
    if (finalAssistant) return entries;
    await sleep(POLL_MS);
  }
  throw new Error(
    `timeout (${timeoutMs}ms) waiting for probe tool + final assistant in conversation ${conversationId}`,
  );
}

export function entryTypesInOrder(entries: ChatEntryRow[]): string[] {
  return [...entries].sort((a, b) => a.conversationIndex - b.conversationIndex).map((entry) => entry.type);
}

export function walkParentChain(entries: ChatEntryRow[], tipId: string): ChatEntryRow[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path: ChatEntryRow[] = [];
  let cursor: string | null = tipId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const row = byId.get(cursor);
    if (!row) throw new Error(`parent chain: unknown entry ${cursor}`);
    path.unshift(row);
    cursor = row.parentId;
  }
  return path;
}

export function assertProbeParentChain(entries: ChatEntryRow[], tipId: string): void {
  const path = walkParentChain(entries, tipId);
  const user = path.find((entry) => entry.type === 'user-message');
  if (!user) throw new Error(`probe parent chain: missing user-message on default-view path`);
  if (user.parentId !== null) {
    throw new Error(`probe parent chain: user-message parentId=${user.parentId}, expected null`);
  }

  const titlePrepare = path.find(
    (entry) => entry.type === 'thought-prepare' && entry.title === 'Title generation',
  );
  if (!titlePrepare) {
    throw new Error(`probe parent chain: missing title thought-prepare on default-view path`);
  }
  if (titlePrepare.parentId !== user.id) {
    throw new Error(
      `probe parent chain: title prepare parentId=${titlePrepare.parentId}, expected user ${user.id}`,
    );
  }

  for (const entry of path) {
    if (entry.parentId === null) continue;
    const parent = entries.find((row) => row.id === entry.parentId);
    if (!parent) {
      throw new Error(`probe parent chain: entry ${entry.id} (${entry.type}) parent ${entry.parentId} missing`);
    }
  }
}

export function assertProbeShape(types: string[]): void {
  const userIdx = types.indexOf('user-message');
  const toolIdx = types.indexOf('tool-invocation');
  const assistantIdx = types.lastIndexOf('assistant-message');
  if (userIdx < 0) throw new Error(`probe shape: missing user-message in ${types.join(',')}`);
  if (toolIdx < 0) throw new Error(`probe shape: missing tool-invocation in ${types.join(',')}`);
  if (assistantIdx < 0) throw new Error(`probe shape: missing assistant-message in ${types.join(',')}`);
  if (toolIdx <= userIdx) {
    throw new Error(`probe shape: tool-invocation before user-message in ${types.join(',')}`);
  }
  if (assistantIdx <= toolIdx) {
    throw new Error(`probe shape: final assistant before tool-invocation in ${types.join(',')}`);
  }

  const thoughtPrepares = types.filter((type) => type === 'thought-prepare').length;
  if (thoughtPrepares < 4) {
    throw new Error(`probe shape: expected >=4 thought-prepare, got ${thoughtPrepares}`);
  }
}

export function assertProbeToolInvocation(entries: ChatEntryRow[]): void {
  const tool = entries.find((entry) => entry.type === 'tool-invocation');
  if (!tool) throw new Error('probe: missing tool-invocation entry');
  if (tool.toolId !== 'get_current_time') {
    throw new Error(`probe: expected get_current_time tool, got ${tool.toolId ?? '(missing)'}`);
  }
}

export async function getConversation(
  baseUrl: string,
  conversationId: string,
): Promise<{ id: string; defaultViewLeafEntryId: string | null }> {
  const res = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}`);
  if (!res.ok) throw new Error(`GET conversation failed: ${res.status}`);
  const row = (await res.json()) as { id?: string; defaultViewLeafEntryId?: string | null };
  if (!row.id) throw new Error('GET conversation: missing id');
  return { id: row.id, defaultViewLeafEntryId: row.defaultViewLeafEntryId ?? null };
}

export async function setDefaultViewLeaf(
  baseUrl: string,
  conversationId: string,
  entryId: string,
): Promise<string> {
  const res = await fetch(
    `${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/default-view-leaf`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`POST default-view-leaf failed: ${res.status} ${detail}`);
  }
  const row = (await res.json()) as { defaultViewLeafEntryId?: string };
  if (!row.defaultViewLeafEntryId) throw new Error('POST default-view-leaf: missing defaultViewLeafEntryId');
  return row.defaultViewLeafEntryId;
}
