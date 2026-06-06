import { APIRequestContext, expect } from "@playwright/test";

export const PROBE_MESSAGE = "what is the time?";

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
