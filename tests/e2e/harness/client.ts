import { APIRequestContext, expect } from "@playwright/test";

export const PROBE_MESSAGE = "what is the time?";
export const KNOWLEDGE_PROBE_MESSAGE = "__rag_probe__ find the indexed database migration notes";
export const STUB_SUMMARIZE_REPLY = "e2e stub summary of folded turns.";
export const STUB_GUARDRAIL_FLAG_REASON = "e2e stub guardrail flag";
export const STUB_ATTACHMENT_SUMMARY_REPLY = "e2e stub attachment summary.";
export const STUB_ASK_ATTACHMENT_REPLY =
  "Dominant palette: deep violet on pure black. Mood: precise, technical, premium — suited to developer tooling.";
export const FOLD_MSG_ONE = "e2e fold message one";
export const FOLD_MSG_TWO = "e2e fold message two";
export const SPLIT_MSG_ONE = "e2e split alpha message";
export const SPLIT_MSG_TWO = "e2e split bravo message";
export const USER_MSG_HELLO = "hello e2e user message";
export const ATTACHMENT_MSG = "see attached e2e notes";
export const GUARDED_AGENT_ID = "e2e00000-0000-4000-8000-000000000002";
export const FORBID_AGENT_ID = "e2e00000-0000-4000-8000-000000000003";

type AgentRow = { id: string; is_default?: boolean };

export function apiBaseUrl(): string {
  const fromEnv = process.env.E2E_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv;
  throw new Error("E2E_API_BASE_URL is required (e.g. http://127.0.0.1:52200)");
}

export async function defaultAgentId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${apiBaseUrl()}/api/agents`);
  expect(res.ok()).toBeTruthy();
  const agents = (await res.json()) as AgentRow[];
  expect(agents.length).toBeGreaterThan(0);
  const agent = agents.find((row) => row.is_default) ?? agents[0];
  if (!agent?.id) throw new Error("e2e setup: no agent id");
  return agent.id;
}

type ConversationRow = {
  id: string;
  groupId: string | null;
  groupPinned?: boolean;
  title: string | null;
};

type ConversationConfig = {
  enabled: boolean;
  sidebarRecentLimit: number;
  prompt: string;
};

export async function getConversationConfig(request: APIRequestContext): Promise<ConversationConfig> {
  const res = await request.get(`${apiBaseUrl()}/api/conversations/config`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ConversationConfig;
}

export async function setConversationConfig(
  request: APIRequestContext,
  patch: Partial<ConversationConfig>,
): Promise<ConversationConfig> {
  const current = await getConversationConfig(request);
  const res = await request.put(`${apiBaseUrl()}/api/conversations/config`, {
    data: { ...current, ...patch },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ConversationConfig;
}

export async function setConversationGroupPinned(
  request: APIRequestContext,
  conversationId: string,
  pinned: boolean,
): Promise<ConversationRow> {
  const res = await request.put(
    `${apiBaseUrl()}/api/conversations/${encodeURIComponent(conversationId)}`,
    { data: { groupPinned: pinned } },
  );
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ConversationRow;
}

export async function createConversation(
  request: APIRequestContext,
  title: string,
): Promise<string> {
  const res = await request.post(`${apiBaseUrl()}/api/conversations`, { data: { title } });
  expect(res.ok()).toBeTruthy();
  const created = (await res.json()) as { id?: string };
  if (!created.id) throw new Error("e2e: POST /api/conversations missing id");
  return created.id;
}

export async function getConversation(
  request: APIRequestContext,
  conversationId: string,
): Promise<ConversationRow> {
  const res = await request.get(
    `${apiBaseUrl()}/api/conversations/${encodeURIComponent(conversationId)}`,
  );
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ConversationRow;
}

export async function listConversations(
  request: APIRequestContext,
): Promise<{ conversations: ConversationRow[]; groups: { id: string; name: string }[] }> {
  const res = await request.get(`${apiBaseUrl()}/api/conversations`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as {
    conversations: ConversationRow[];
    groups: { id: string; name: string }[];
  };
}

export async function moveConversationToGroup(
  request: APIRequestContext,
  conversationId: string,
  target: { groupId?: string | null; newGroupName?: string },
): Promise<ConversationRow> {
  const res = await request.put(
    `${apiBaseUrl()}/api/conversations/${encodeURIComponent(conversationId)}`,
    { data: target },
  );
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ConversationRow;
}

export async function createProbeConversation(
  request: APIRequestContext,
  agentId: string,
): Promise<string> {
  const createRes = await request.post(`${apiBaseUrl()}/api/conversations`, {
    data: { title: "e2e probe" },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = (await createRes.json()) as { id?: string };
  if (!created.id) throw new Error("e2e: POST /api/conversations missing id");

  const msgRes = await request.post(
    `${apiBaseUrl()}/api/conversations/${encodeURIComponent(created.id)}/messages`,
    { data: { message: PROBE_MESSAGE, agentId } },
  );
  expect(msgRes.ok()).toBeTruthy();
  return created.id;
}

type TranscriptEntry = { type: string; thoughtType?: string; title?: string };

export async function getConversationEntries(
  request: APIRequestContext,
  conversationId: string,
): Promise<TranscriptEntry[]> {
  // all=1: side-lane thought entries (title/categorize/…) hang off their
  // anchor without being on the default-view lineage — tests polling for
  // them need the full entry set.
  const res = await request.get(
    `${apiBaseUrl()}/api/conversations/${encodeURIComponent(conversationId)}/messages?all=1`,
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { entries: TranscriptEntry[] };
  return body.entries;
}

export type TaskInfo = {
  id: string;
  kind: "llm" | "tool";
  title: string;
  conversationId: string | null;
  status: "running" | "cancelling";
  startedAt: string;
};

export async function listTasks(request: APIRequestContext): Promise<TaskInfo[]> {
  const res = await request.get(`${apiBaseUrl()}/api/tasks`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { tasks: TaskInfo[] };
  return body.tasks;
}

/**
 * Block until the backend reports no in-flight LLM/tool tasks. A test must
 * never conclude while work is still running: a still-streaming or leaked task
 * means the UI assertions raced ahead of the backend (the exact shape of flake
 * we want to catch, not paper over). Resolves once drained; throws after
 * `timeoutMs`, naming whatever is still pending.
 */
export async function waitForNoPendingTasks(
  request: APIRequestContext,
  opts: { timeoutMs: number; conversationId?: string },
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  let pending: TaskInfo[] = [];
  for (;;) {
    pending = await listTasks(request);
    if (opts.conversationId) {
      pending = pending.filter((t) => t.conversationId === opts.conversationId);
    }
    if (pending.length === 0) return;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const summary = pending.map((t) => `${t.kind} "${t.title}" [${t.status}]`).join("; ");
  throw new Error(
    `Pending backend tasks did not drain within ${opts.timeoutMs}ms: ${summary}`,
  );
}
