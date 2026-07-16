import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import {
  apiBaseUrl,
  createProbeConversation,
  defaultAgentId,
  getConversationEntries,
  waitForNoPendingTasks,
} from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

/**
 * Forced retrieval (docs/knowledge-revamp-plan.md, phase 2a): a user message carrying
 * `overrides.knowledge` runs harness-driven retrieval BEFORE the planner and records
 * it as a `retrieval` chat entry the planner prompt folds in — distinct from
 * the model-driven `knowledge` tool (covered by 08-knowledge). Embeddings go through the
 * stub provider (deterministic bag-of-words), so ranking is stable without a
 * live model.
 */

const DB_DOC = "SQLite database migrations are managed by Prisma. Run the migration to update the schema.";
const COOK_DOC = "A tomato basil pasta recipe: boil water, add salt, then cook the pasta.";
// Bag-of-words overlap targets db.md, not cooking.md.
const DB_QUESTION = "How are the SQLite database migrations managed and applied to the schema?";

type RetrievalEntryShape = {
  type: "context-injection";
  source: "knowledge";
  state: string;
  storages: string[];
  queries: Array<{ text: string; origin: string }>;
  hits: Array<{ storage: string; source: string; text: string; origin: string }>;
};
type StreamEntry = { type: string; thoughtType?: string; llmRequest?: string };

async function makeDocs(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "e2e-forced-knowledge-"));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
  return dir;
}

/** Create a stub-embedded files storage via the API; ingest unless `skipIngest`. */
async function createStorage(
  request: APIRequestContext,
  name: string,
  root: string,
  opts: { skipIngest?: boolean } = {},
): Promise<string> {
  const createRes = await request.post(`${apiBaseUrl()}/api/knowledge/storages`, {
    data: {
      name,
      entitySource: "files",
      embeddingProviderId: "stub",
      embeddingModel: "stub-embed",
      sourceParams: { roots: [root] },
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const storage = (await createRes.json()) as { id: string };
  if (!opts.skipIngest) {
    const ingestRes = await request.post(`${apiBaseUrl()}/api/knowledge/storages/${storage.id}/ingest`, {
      data: {},
    });
    expect(ingestRes.ok()).toBeTruthy();
  }
  return storage.id;
}

async function deleteStorage(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`${apiBaseUrl()}/api/knowledge/storages/${encodeURIComponent(id)}`);
}

/** The agent's per-request baseline total — first-message composer totals
 *  include it, so exact-number assertions are computed relative to it. */
async function baselineTotal(request: APIRequestContext, agentId: string): Promise<number> {
  const res = await request.post(`${apiBaseUrl()}/api/planner-baseline/preview`, { data: { agentId } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { totalTokens: number }).totalTokens;
}

async function retrievalEntryOf(
  request: APIRequestContext,
  conversationId: string,
): Promise<RetrievalEntryShape | undefined> {
  const entries = (await getConversationEntries(request, conversationId)) as unknown as Array<
    RetrievalEntryShape | { type: string; source?: string }
  >;
  return entries.find((e): e is RetrievalEntryShape => e.type === "context-injection" && e.source === "knowledge");
}

async function postKnowledgeMessage(
  request: APIRequestContext,
  agentId: string,
  storageId: string,
  message: string,
  mode?: "verbatim" | "preplanned",
): Promise<string> {
  const createRes = await request.post(`${apiBaseUrl()}/api/conversations`, {
    data: { title: "e2e forced retrieval" },
  });
  expect(createRes.ok()).toBeTruthy();
  const { id } = (await createRes.json()) as { id: string };
  const msgRes = await request.post(`${apiBaseUrl()}/api/conversations/${encodeURIComponent(id)}/messages`, {
    data: {
      message,
      agentId,
      overrides: { knowledge: { storages: [storageId], ...(mode ? { mode } : {}) } },
    },
  });
  expect(msgRes.ok()).toBeTruthy();
  return id;
}

test("overrides.knowledge runs retrieval before the planner; entry + planner prompt carry the hits", async ({
  request,
}) => {
  test.setTimeout(25_000);
  const agentId = await defaultAgentId(request);
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const storageId = await createStorage(request, `e2e-forced-${Date.now()}`, docs);
  try {
    const conversationId = await postKnowledgeMessage(request, agentId, storageId, DB_QUESTION);

    // The retrieval entry resolves to done with the right doc on top.
    await expect
      .poll(async () => (await retrievalEntryOf(request, conversationId))?.state ?? "missing", {
        timeout: 15_000,
      })
      .toBe("done");
    const entry = (await retrievalEntryOf(request, conversationId))!;
    expect(entry.queries).toEqual([{ text: DB_QUESTION, origin: "verbatim" }]);
    expect(entry.hits.length).toBeGreaterThan(0);
    expect(entry.hits[0]!.source).toBe("db.md");
    expect(entry.hits[0]!.origin).toBe("seed");

    // Ground-truth: the planner's own prompt carried the excerpt, not just
    // the audit entry.
    await expect
      .poll(
        async () => {
          const entries = (await getConversationEntries(request, conversationId)) as unknown as StreamEntry[];
          const planner = entries.find((e) => e.type === "thought" && e.thoughtType === "planner");
          const prompt = planner?.llmRequest ?? "";
          return prompt.includes("[User-requested retrieval") && prompt.includes("managed by Prisma");
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  } finally {
    await deleteStorage(request, storageId);
    await rm(docs, { recursive: true, force: true });
  }
});

test("zero hits stay visible: empty storage yields done + no hits, and the planner is told", async ({
  request,
}) => {
  test.setTimeout(25_000);
  const agentId = await defaultAgentId(request);
  const docs = await makeDocs({});
  // Created but never ingested — retrieval over it finds nothing.
  const storageId = await createStorage(request, `e2e-forced-empty-${Date.now()}`, docs, { skipIngest: true });
  try {
    const conversationId = await postKnowledgeMessage(request, agentId, storageId, DB_QUESTION);

    await expect
      .poll(async () => (await retrievalEntryOf(request, conversationId))?.state ?? "missing", {
        timeout: 15_000,
      })
      .toBe("done");
    const entry = (await retrievalEntryOf(request, conversationId))!;
    expect(entry.hits).toEqual([]);

    await expect
      .poll(
        async () => {
          const entries = (await getConversationEntries(request, conversationId)) as unknown as StreamEntry[];
          const planner = entries.find((e) => e.type === "thought" && e.thoughtType === "planner");
          return planner?.llmRequest?.includes("No relevant content was found") ?? false;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  } finally {
    await deleteStorage(request, storageId);
    await rm(docs, { recursive: true, force: true });
  }
});

test("preplanned mode: a knowledge_planning thought composes the queries, retrieval records them as planned", async ({
  request,
}) => {
  test.setTimeout(25_000);
  const agentId = await defaultAgentId(request);
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const storageId = await createStorage(request, `e2e-preplanned-${Date.now()}`, docs);
  try {
    const conversationId = await postKnowledgeMessage(request, agentId, storageId, DB_QUESTION, "preplanned");

    await expect
      .poll(async () => (await retrievalEntryOf(request, conversationId))?.state ?? "missing", {
        timeout: 15_000,
      })
      .toBe("done");
    const entry = (await retrievalEntryOf(request, conversationId))!;
    // The stub planning reply (STUB_KNOWLEDGE_PLANNING_REPLY) is two planned queries.
    expect(entry.queries.map((q) => q.origin)).toEqual(["planned", "planned"]);
    expect(entry.queries[0]!.text).toBe("SQLite database migrations Prisma");
    expect(entry.hits.length).toBeGreaterThan(0);
    expect(entry.hits[0]!.source).toBe("db.md");

    // The planning thought is visible in the transcript, and the planner
    // still anchors after the retrieval entry (its prompt carries the hits).
    const entries = (await getConversationEntries(request, conversationId)) as unknown as StreamEntry[];
    const planning = entries.find((e) => e.type === "thought" && e.thoughtType === "knowledge_planning");
    expect(planning).toBeTruthy();
    await expect
      .poll(
        async () => {
          const all = (await getConversationEntries(request, conversationId)) as unknown as StreamEntry[];
          const planner = all.find((e) => e.type === "thought" && e.thoughtType === "planner");
          const prompt = planner?.llmRequest ?? "";
          return prompt.includes("[User-requested retrieval") && prompt.includes("managed by Prisma");
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  } finally {
    await deleteStorage(request, storageId);
    await rm(docs, { recursive: true, force: true });
  }
});

test("typing alone prices the send — tokens and cost from the provider's live catalog pricing", async ({
  app,
  request,
}) => {
  test.setTimeout(20_000);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  // No knowledge, no files, no attachments — the message text itself is
  // estimated (chars/4) and the rollup appears as soon as there is one. The
  // stub provider publishes fixed catalog pricing, so ≈$ shows too.
  await app.chat.userInput.typeMessage("hello estimator, price this message");
  await expect(app.page.getByTestId("chat-context-total")).toHaveText(/~\d+ tok · ≈\$\d/);
});

test("direct attachments count into the estimate: text by size, images by measured pixels", async ({
  app,
  request,
}) => {
  test.setTimeout(20_000);
  const agentId = await defaultAgentId(request);
  const base = await baselineTotal(request, agentId);
  await app.chat.gotoNew(agentId);

  // 20 chars → ~5 tok of message text, on top of the per-request baseline.
  await app.chat.userInput.typeMessage("estimate attachments");
  await expect(app.page.getByTestId("chat-context-total")).toContainText(`~${base + 5} tok`);

  // 400 bytes of text/plain, mode 'direct' by default → +100 tok, exact.
  const fileInput = app.page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(400, "a"),
  });
  await expect(app.page.getByTestId("chat-context-total")).toContainText(`~${base + 105} tok`);

  // A 1×1 PNG, 'direct' by default → measured to 1 vision token (pixels/750,
  // floored at 1) — a knowable amount, not an at-send "?" (which would render
  // as "~N + ? tok" and fail the match). Each picker use appends.
  const onePxPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  await fileInput.setInputFiles({ name: "dot.png", mimeType: "image/png", buffer: onePxPng });
  await expect(app.page.getByTestId("chat-context-total")).toContainText(`~${base + 106} tok`);
});

test("direct PDFs price per sniffed page; images price by the send model's family rules", async ({
  app,
  request,
}) => {
  test.setTimeout(25_000);
  const agentId = await defaultAgentId(request);
  const base = await baselineTotal(request, agentId);
  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage("estimate attachments"); // ~5 tok

  // A minimal 2-page PDF (uncompressed xref, two /Type /Page objects).
  // Defaults to Summary — flip its chip to Direct → 2 × 1500/page (generic
  // family: the default agent's model is 'stub').
  const twoPagePdf = Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type /Pages /Kids [3 0 R 4 0 R] /Count 2>>endobj\n" +
      "3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>endobj\n" +
      "4 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>endobj\n" +
      "trailer<</Root 1 0 R>>\n%%EOF",
  );
  // NOTE: the chip previews PDFs in an <iframe src=blob:>; Chromium's PDF
  // viewer holds a streaming fetch open, which aborts when the test's page
  // closes. That specific requestfailed line is allowlisted by title in
  // scripts/test-diagnostics.mjs.
  await app.page.locator('input[type="file"]').setInputFiles({
    name: "doc.pdf",
    mimeType: "application/pdf",
    buffer: twoPagePdf,
  });
  await app.page
    .getByRole("radiogroup", { name: "Attachment mode" })
    .getByRole("radio", { name: "Direct" })
    .click();
  await expect(app.page.getByTestId("chat-context-total")).toContainText(`~${base + 3005} tok`);
});

test("image estimate follows the model family: a claude-named model applies the pixel cap", async ({
  app,
  request,
}) => {
  test.setTimeout(25_000);
  // Any stub-provider agent works — family detection reads the model NAME.
  const createRes = await request.post(`${apiBaseUrl()}/api/agents`, {
    data: {
      name: `e2e-claude-family-${Date.now()}`,
      system_prompt: "e2e",
      default_llm_configuration: { provider_id: "stub", model_name: "anthropic/claude-test" },
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const agent = (await createRes.json()) as { id: string };
  try {
    const base = await baselineTotal(request, agent.id);
    await app.chat.gotoNew(agent.id);
    await app.chat.userInput.typeMessage("estimate attachments"); // ~5 tok

    // Generate a real 1500×1000 PNG in-page: 1.5Mpx exceeds claude's ~1.15Mpx
    // downscale cap → ceil(1_150_000 / 750) = 1534 tok (generic would be 2000).
    await app.page.evaluate(async () => {
      const canvas = new OffscreenCanvas(1500, 1000);
      canvas.getContext("2d")!.fillRect(0, 0, 1500, 1000);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const file = new File([blob], "big.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(app.page.getByTestId("chat-context-total")).toContainText(`~${base + 1539} tok`);
  } finally {
    await request.delete(`${apiBaseUrl()}/api/agents/${agent.id}`);
  }
});

test("planner-baseline preview prices system prompt and each tool separately; overrides shrink it", async ({
  request,
}) => {
  test.setTimeout(15_000);
  const agentId = await defaultAgentId(request);
  const res = await request.post(`${apiBaseUrl()}/api/planner-baseline/preview`, { data: { agentId } });
  expect(res.ok()).toBeTruthy();
  const baseline = (await res.json()) as {
    totalTokens: number;
    systemPrompt: { tokens: number };
    scaffolding: { tokens: number };
    tools: { tokens: number; perTool: Array<{ name: string; tokens: number; line: string }> };
  };
  expect(baseline.totalTokens).toBeGreaterThan(0);
  expect(baseline.scaffolding.tokens).toBeGreaterThan(0);
  const probeTool = baseline.tools.perTool.find((t) => t.name === "get_current_time");
  expect(probeTool?.tokens ?? 0).toBeGreaterThan(0);
  expect(probeTool?.line).toContain("get_current_time");

  // Flipping a tool off via overrides drops its line (and the tools price).
  const offRes = await request.post(`${apiBaseUrl()}/api/planner-baseline/preview`, {
    data: { agentId, toolOverrides: { get_current_time: { policy: "off" } } },
  });
  expect(offRes.ok()).toBeTruthy();
  const withoutTool = (await offRes.json()) as typeof baseline;
  expect(withoutTool.tools.perTool.some((t) => t.name === "get_current_time")).toBe(false);
  expect(withoutTool.tools.tokens).toBeLessThan(baseline.tools.tokens);
});

test("Start context shows the planner baseline with a per-tool breakdown", async ({ app, request }) => {
  test.setTimeout(20_000);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  const section = app.page.getByTestId("planner-baseline-section");
  await expect(section.getByTestId("planner-baseline-total")).toHaveText(/~\d+ tok/);
  await section.getByTestId("baseline-tools-row").click();
  const toolRow = section.locator('[data-testid="baseline-tool-row"][data-tool-name="get_current_time"]');
  await expect(toolRow).toContainText(/~\d+ tok/);
});

test("verifying a provider persists discovered catalog pricing into the capability rows", async ({ request }) => {
  test.setTimeout(20_000);
  // The stub provider's discoverModels publishes fixed rates; a verify
  // (test_connection) must land them on the discovered capability rows.
  const testRes = await request.post(`${apiBaseUrl()}/api/settings/llm_provider/test_connection`, {
    data: { provider_id: "stub" },
  });
  expect(testRes.ok()).toBeTruthy();
  const tested = (await testRes.json()) as { ok: boolean; models: string[] };
  expect(tested.ok).toBe(true);
  expect(tested.models).toContain("stub-model");

  const capsRes = await request.get(`${apiBaseUrl()}/api/settings/model_capabilities`);
  expect(capsRes.ok()).toBeTruthy();
  const caps = (await capsRes.json()) as {
    models: Array<{
      provider_id: string;
      model_name: string;
      input_cost_per_1m: number | null;
      output_cost_per_1m: number | null;
      source: string;
    }>;
  };
  const row = caps.models.find((m) => m.provider_id === "stub" && m.model_name === "stub-model");
  expect(row?.source).toBe("discovered");
  expect(row?.input_cost_per_1m).toBe(2);
  expect(row?.output_cost_per_1m).toBe(10);
});

test("a model without any pricing offers a set-price link next to the estimate", async ({ app, request }) => {
  test.setTimeout(20_000);
  // 'e2e-unpriced' is off the stub provider's priced catalog and has no
  // capability override — the estimate must offer the fix, not stay silent.
  const createRes = await request.post(`${apiBaseUrl()}/api/agents`, {
    data: {
      name: `e2e-unpriced-${Date.now()}`,
      system_prompt: "e2e",
      default_llm_configuration: { provider_id: "stub", model_name: "e2e-unpriced" },
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const agent = (await createRes.json()) as { id: string };
  try {
    await app.chat.gotoNew(agent.id);
    await app.chat.userInput.typeMessage("price this message please");
    await expect(app.page.getByTestId("chat-context-total")).toHaveText(/~\d+ tok(?!.*≈\$)/);
    const link = app.page.getByTestId("set-price-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /\/settings\/model-pricing\?focus=e2e-unpriced/);
  } finally {
    await request.delete(`${apiBaseUrl()}/api/agents/${agent.id}`);
  }
});

test("preview endpoint returns the hits and token estimate a send would inject", async ({ request }) => {
  test.setTimeout(25_000);
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const storageId = await createStorage(request, `e2e-forced-preview-${Date.now()}`, docs);
  try {
    const res = await request.post(`${apiBaseUrl()}/api/knowledge/retrieve/preview`, {
      data: { query: DB_QUESTION, storages: [storageId] },
    });
    expect(res.ok()).toBeTruthy();
    const preview = (await res.json()) as {
      hits: Array<{ source: string; origin: string }>;
      estimatedTokens: number;
    };
    expect(preview.hits.length).toBeGreaterThan(0);
    expect(preview.hits[0]!.source).toBe("db.md");
    // The estimate covers the full planner block (header + excerpts), so it
    // must exceed a bare header's worth of tokens.
    expect(preview.estimatedTokens).toBeGreaterThan(50);
  } finally {
    await deleteStorage(request, storageId);
    await rm(docs, { recursive: true, force: true });
  }
});

test("composer Context panel (existing conversation): knowledge toggle + storage preview the injection with examinable hits and a total, send records it, and the draft resets", async ({
  app,
  request,
}) => {
  test.setTimeout(30_000);
  const agentId = await defaultAgentId(request);
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const name = `e2e-forced-ui-${Date.now()}`;
  const storageId = await createStorage(request, name, docs);
  try {
    const conversationId = await createProbeConversation(request, agentId);
    await waitForNoPendingTasks(request, { timeoutMs: 15_000, conversationId });
    await app.chat.open(conversationId);

    // Open the Context panel, switch knowledge search on, pick the storage.
    await app.page.getByTestId("chat-context-chip").click();
    await app.page.getByTestId("chat-knowledge-toggle").click();
    await app.page.locator(`[data-testid="chat-knowledge-storage"][data-storage-name="${name}"]`).click();

    // Live preview: typing runs the actual retrieval (debounced) and reports
    // what a send right now would inject.
    await app.chat.userInput.typeMessage(DB_QUESTION);
    const previewText = app.page.getByTestId("retrieval-preview");
    await expect(previewText).toContainText(/excerpts? · ~\d+ tok/, { timeout: 10_000 });

    // The hits are examinable before sending, and the rollup prices the send.
    const firstExcerpt = app.page.getByTestId("context-excerpt-row").first();
    await expect(firstExcerpt).toContainText("db.md");
    await firstExcerpt.click();
    await expect(app.page.getByTestId("context-excerpt-text")).toContainText("managed by Prisma");
    await expect(app.page.getByTestId("chat-context-total")).toHaveText(/~\d+ tok/);

    await app.chat.userInput.send();

    const row = app.page.getByTestId("retrieval-row");
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("retrieval-summary")).toContainText("Retrieved", { timeout: 15_000 });
    await row.getByRole("button").first().click();
    await expect(row.getByTestId("retrieval-hit-source").first()).toHaveText("db.md");
    await expect(row.getByTestId("retrieval-query-origin").first()).toHaveText("verbatim");

    // Single-shot: no navigation on an existing conversation, so the toggle is
    // still mounted — it switched itself off after sending.
    await expect(app.page.getByTestId("chat-knowledge-toggle")).toHaveAttribute("aria-pressed", "false");
  } finally {
    await deleteStorage(request, storageId);
    await rm(docs, { recursive: true, force: true });
  }
});

test("new chat: knowledge search staged in Start context rides the first send", async ({ app, request }) => {
  test.setTimeout(30_000);
  const agentId = await defaultAgentId(request);
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const name = `e2e-start-knowledge-${Date.now()}`;
  const storageId = await createStorage(request, name, docs);
  try {
    await app.chat.gotoNew(agentId);

    // The Start context section hosts the same single-shot knowledge controls.
    const section = app.page.getByTestId("start-context-section");
    await section.getByTestId("chat-knowledge-toggle").click();
    await section.locator(`[data-testid="chat-knowledge-storage"][data-storage-name="${name}"]`).click();

    // The composer estimate prices the staged search while typing.
    await app.chat.userInput.typeMessage(DB_QUESTION);
    await expect(app.page.getByTestId("chat-context-total")).toHaveText(/~\d+ tok/, { timeout: 10_000 });

    await app.chat.userInput.send();
    const row = app.page.getByTestId("retrieval-row");
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("retrieval-summary")).toContainText("Retrieved", { timeout: 15_000 });
  } finally {
    await deleteStorage(request, storageId);
    await rm(docs, { recursive: true, force: true });
  }
});
