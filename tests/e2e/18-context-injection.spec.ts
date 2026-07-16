import { APIRequestContext } from "@playwright/test";
import {
  apiBaseUrl,
  createProbeConversation,
  defaultAgentId,
  FORBID_AGENT_ID,
  getConversationEntries,
  PROBE_MESSAGE,
  waitForNoPendingTasks,
} from "./harness/client";
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
          const planner = entries.find((e) => e.type === "thought" && e.thoughtType === "planner");
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

test("preview endpoint prices the exact scan a first message would inject", async ({ request }) => {
  test.setTimeout(15_000);
  const agentId = await defaultAgentId(request);
  const original = await setAgentPreinject(request, agentId, { mode: "all" });

  try {
    const res = await request.get(`${apiBaseUrl()}/api/context-injection/preview?agentId=${agentId}`);
    expect(res.ok()).toBeTruthy();
    const preview = (await res.json()) as {
      mode: string;
      files: Array<{ path: string; status: string; tokens?: number; content?: string }>;
      totalTokens: number;
    };
    expect(preview.mode).toBe("all");
    const readme = preview.files.find((f) => f.path === "README.md");
    expect(readme?.status).toBe("injected");
    expect(readme?.tokens ?? 0).toBeGreaterThan(0);
    // The examinable content is the exact planner section for this file.
    expect(readme?.content).toContain(README_MARKER);
    expect(preview.totalTokens).toBeGreaterThan(0);
  } finally {
    await setAgentPreinject(request, agentId, original?.preinject as Record<string, unknown> | undefined);
  }
});

test("preview endpoint: an unset preinject config reads as mode 'none' with nothing injected", async ({
  request,
}) => {
  test.setTimeout(15_000);
  // FORBID_AGENT_ID's seeded config has no `preinject` key at all.
  const res = await request.get(`${apiBaseUrl()}/api/context-injection/preview?agentId=${FORBID_AGENT_ID}`);
  expect(res.ok()).toBeTruthy();
  const preview = (await res.json()) as { mode: string; files: unknown[]; totalTokens: number };
  expect(preview.mode).toBe("none");
  expect(preview.files).toEqual([]);
  expect(preview.totalTokens).toBe(0);
});

test("new chat: the Start context section lists the files half pre-send and the composer prices it", async ({
  app,
  request,
}) => {
  test.setTimeout(30_000);
  const agentId = await defaultAgentId(request);
  const original = await setAgentPreinject(request, agentId, { mode: "all" });

  try {
    await app.chat.gotoNew(agentId);

    // Start context section (sibling of Tool sandbox / Agent): per-file rows
    // carry their own token estimate, and the content the planner would
    // receive is examinable in place.
    const section = app.page.getByTestId("start-context-section");
    await expect(section.getByTestId("start-context-tokens")).toHaveText(/~\d+ tok/);
    const readmeRow = section.locator('[data-testid="context-file-row"][data-file-path="README.md"]');
    await expect(readmeRow).toContainText(/~\d+ tok/);
    await readmeRow.click();
    await expect(section.getByTestId("context-file-content")).toContainText(README_MARKER);

    // Composer rollup prices the same scan; its panel points at the section.
    await expect(app.page.getByTestId("chat-context-summary")).toContainText(/\d+ files?/);
    await expect(app.page.getByTestId("chat-context-total")).toHaveText(/~\d+ tok/);
    await app.page.getByTestId("chat-context-chip").click();
    await expect(app.page.getByTestId("context-files-note")).toContainText("Start context above");
  } finally {
    await setAgentPreinject(request, agentId, original?.preinject as Record<string, unknown> | undefined);
  }
});

test("existing conversation: the composer panel attaches candidate files to the next message only", async ({
  app,
  request,
}) => {
  test.setTimeout(30_000);
  const agentId = await defaultAgentId(request);
  // No preinject config on the agent: the probe conversation starts with no
  // files entry, so the one that appears below is the manual attach.
  const conversationId = await createProbeConversation(request, agentId);
  await app.chat.open(conversationId);

  // Pick README.md in the attach picker; the rollup prices the selection.
  await app.page.getByTestId("chat-context-chip").click();
  await app.page.locator('[data-testid="context-file-check"][data-file-path="README.md"]').check();
  await expect(app.page.getByTestId("context-files-tokens")).toContainText("1 selected");
  await expect(app.page.getByTestId("chat-context-total")).toHaveText(/~\d+ tok/);

  await app.chat.userInput.typeMessage(PROBE_MESSAGE);
  await app.chat.userInput.send();

  // The attach lands as the same context-injection entry the first-message
  // scan produces, and the single-shot draft reset after sending.
  await expect(app.page.getByTestId("context-injection-row")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await contextInjectionEntry(request, conversationId))?.files?.[0]?.path ?? "missing", {
      timeout: 15_000,
    })
    .toBe("README.md");
  const entry = (await contextInjectionEntry(request, conversationId))!;
  expect(entry.files).toEqual([{ path: "README.md", fileType: "readme", status: "injected" }]);
  expect(entry.content).toContain(README_MARKER);
  await expect(app.page.getByTestId("chat-context-summary")).toHaveText("nothing injected");
});

test("overrides.contextFiles injects the picked candidates and the planner sees them", async ({ request }) => {
  test.setTimeout(25_000);
  const agentId = await defaultAgentId(request);
  const conversationId = await createProbeConversation(request, agentId);

  // Let the first turn settle, then chain the follow-up onto its spine tip —
  // the turn's assistant message (a second message must name its parent).
  await waitForNoPendingTasks(request, { timeoutMs: 15_000, conversationId });
  const settled = (await getConversationEntries(request, conversationId)) as unknown as Array<{
    id: string;
    type: string;
  }>;
  const leafId = [...settled].reverse().find((e) => e.type === "assistant-message")?.id;
  expect(leafId).toBeTruthy();

  const msgRes = await request.post(`${apiBaseUrl()}/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    data: {
      message: "ground this in the readme",
      agentId,
      parentId: leafId,
      overrides: { contextFiles: { paths: ["README.md", "../etc/passwd"] } },
    },
  });
  expect(msgRes.ok()).toBeTruthy();

  await expect
    .poll(async () => (await contextInjectionEntry(request, conversationId))?.files?.length ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  const entry = (await contextInjectionEntry(request, conversationId))!;
  // Only the candidate-list path landed; the traversal attempt was dropped.
  expect(entry.files).toEqual([{ path: "README.md", fileType: "readme", status: "injected" }]);
  expect(entry.content).toContain(README_MARKER);

  await expect
    .poll(
      async () => {
        const entries = (await getConversationEntries(request, conversationId)) as unknown as StreamEntry[];
        const planners = entries.filter((e) => e.type === "thought" && e.thoughtType === "planner");
        return planners.some((p) => p.llmRequest?.includes(README_MARKER) ?? false);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("preview endpoint ?all=1 lists every candidate regardless of agent gating", async ({ request }) => {
  test.setTimeout(15_000);
  const res = await request.get(`${apiBaseUrl()}/api/context-injection/preview?all=1`);
  expect(res.ok()).toBeTruthy();
  const preview = (await res.json()) as {
    mode: string;
    files: Array<{ path: string; status: string; tokens?: number }>;
    totalTokens: number;
  };
  expect(preview.mode).toBe("all");
  const readme = preview.files.find((f) => f.path === "README.md");
  expect(readme?.status).toBe("injected");
  expect(readme?.tokens ?? 0).toBeGreaterThan(0);
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
