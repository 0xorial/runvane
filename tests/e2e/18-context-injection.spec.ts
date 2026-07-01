import { APIRequestContext } from "@playwright/test";
import { apiBaseUrl, createProbeConversation, defaultAgentId, FORBID_AGENT_ID, getConversationEntries } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// A distinctive substring of the scanned workspace root's README.md — proof
// the planner's prompt actually carried the injected file content, not just
// that the context-injection entry was persisted. The e2e harness runs the
// backend and Vite in one process, and Vite's dev-server startup chdirs the
// whole process into frontend/ for the run's duration (see
// tests/e2e-dev-server.mjs) — so `process.cwd()` (the scan root, same as the
// filesystem tool's default `allowed_roots`) resolves to frontend/ here, not
// the repo root.
const README_MARKER = "Svelte 5 + Vite client for Runvane.";

type PreinjectedFile = { path: string; fileType: string; status: "injected" | "skipped" };
type ContextInjectionEntry = { type: "context-injection"; files: PreinjectedFile[]; content: string };
type StreamEntry = { type: string; thoughtType?: string; llmRequest?: string };

async function getAgentConfig(
  request: APIRequestContext,
  agentId: string,
): Promise<{ name: string; default_llm_configuration: Record<string, unknown> | null }> {
  const res = await request.get(`${apiBaseUrl()}/api/agents/${agentId}`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function setAgentPreinject(
  request: APIRequestContext,
  agentId: string,
  preinject: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | null> {
  const agent = await getAgentConfig(request, agentId);
  const original = agent.default_llm_configuration ?? null;
  const nextCfg: Record<string, unknown> = { ...(original ?? {}) };
  if (preinject === undefined) delete nextCfg.preinject;
  else nextCfg.preinject = preinject;
  const putRes = await request.put(`${apiBaseUrl()}/api/agents/${agentId}`, {
    data: { name: agent.name, default_llm_configuration: nextCfg },
  });
  expect(putRes.ok()).toBeTruthy();
  return original;
}

async function contextInjectionEntry(
  request: APIRequestContext,
  conversationId: string,
): Promise<ContextInjectionEntry | undefined> {
  const entries = (await getConversationEntries(request, conversationId)) as unknown as Array<
    ContextInjectionEntry | StreamEntry | { type: string }
  >;
  return entries.find((e): e is ContextInjectionEntry => e.type === "context-injection");
}

test("mode 'all' injects every discovered file and the planner sees the content", async ({ request }) => {
  test.setTimeout(25_000);
  const agentId = await defaultAgentId(request);
  const original = await setAgentPreinject(request, agentId, { mode: "all" });

  try {
    const conversationId = await createProbeConversation(request, agentId);

    const entry = await contextInjectionEntry(request, conversationId);
    expect(entry, "expected a context-injection entry on the chain").toBeTruthy();
    const readme = entry!.files.find((f) => f.path === "README.md");
    const manifest = entry!.files.find((f) => f.path === "package.json");
    expect(readme?.status).toBe("injected");
    expect(readme?.fileType).toBe("readme");
    expect(manifest?.status).toBe("injected");
    expect(manifest?.fileType).toBe("manifest");
    expect(entry!.content).toContain(README_MARKER);

    // Ground-truth: the planner's own prompt (not just the audit entry) carried it.
    await expect
      .poll(
        async () => {
          const entries = (await getConversationEntries(request, conversationId)) as unknown as StreamEntry[];
          const planner = entries.find((e) => e.type === "thought_stream" && e.thoughtType === "planner");
          return planner?.llmRequest?.includes(README_MARKER) ?? false;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  } finally {
    await setAgentPreinject(request, agentId, original?.preinject as Record<string, unknown> | undefined);
  }
});

test("mode 'selected' only injects the chosen category; others are recorded as skipped", async ({ request }) => {
  test.setTimeout(25_000);
  const agentId = await defaultAgentId(request);
  const original = await setAgentPreinject(request, agentId, { mode: "selected", types: ["readme"] });

  try {
    const conversationId = await createProbeConversation(request, agentId);

    const entry = await contextInjectionEntry(request, conversationId);
    expect(entry, "expected a context-injection entry on the chain").toBeTruthy();
    const readme = entry!.files.find((f) => f.path === "README.md");
    const manifest = entry!.files.find((f) => f.path === "package.json");
    expect(readme?.status).toBe("injected");
    expect(manifest?.status).toBe("skipped");
    expect(entry!.content).toContain(README_MARKER);
  } finally {
    await setAgentPreinject(request, agentId, original?.preinject as Record<string, unknown> | undefined);
  }
});

test("agents without a preinject config get no context-injection entry", async ({ request }) => {
  test.setTimeout(25_000);
  // FORBID_AGENT_ID's seeded config has no `preinject` key at all — the
  // default-'none' behavior must produce no entry (no regression for agents
  // that never opt in).
  const conversationId = await createProbeConversation(request, FORBID_AGENT_ID);
  const entry = await contextInjectionEntry(request, conversationId);
  expect(entry).toBeUndefined();
});
