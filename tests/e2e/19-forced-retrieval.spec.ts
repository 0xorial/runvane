import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { apiBaseUrl, defaultAgentId, getConversationEntries } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

/**
 * Forced retrieval (docs/rag-revamp-plan.md, phase 2a): a user message carrying
 * `overrides.rag` runs harness-driven retrieval BEFORE the planner and records
 * it as a `retrieval` chat entry the planner prompt folds in — distinct from
 * the model-driven `rag` tool (covered by 08-rag). Embeddings go through the
 * stub provider (deterministic bag-of-words), so ranking is stable without a
 * live model.
 */

const DB_DOC = "SQLite database migrations are managed by Prisma. Run the migration to update the schema.";
const COOK_DOC = "A tomato basil pasta recipe: boil water, add salt, then cook the pasta.";
// Bag-of-words overlap targets db.md, not cooking.md.
const DB_QUESTION = "How are the SQLite database migrations managed and applied to the schema?";

type RetrievalEntryShape = {
  type: "retrieval";
  state: string;
  storages: string[];
  queries: Array<{ text: string; origin: string }>;
  hits: Array<{ storage: string; source: string; text: string; origin: string }>;
};
type StreamEntry = { type: string; thoughtType?: string; llmRequest?: string };

async function makeDocs(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "e2e-forced-rag-"));
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
  const createRes = await request.post(`${apiBaseUrl()}/api/rag/storages`, {
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
    const ingestRes = await request.post(`${apiBaseUrl()}/api/rag/storages/${storage.id}/ingest`, {
      data: {},
    });
    expect(ingestRes.ok()).toBeTruthy();
  }
  return storage.id;
}

async function deleteStorage(request: APIRequestContext, id: string): Promise<void> {
  await request.delete(`${apiBaseUrl()}/api/rag/storages/${encodeURIComponent(id)}`);
}

async function retrievalEntryOf(
  request: APIRequestContext,
  conversationId: string,
): Promise<RetrievalEntryShape | undefined> {
  const entries = (await getConversationEntries(request, conversationId)) as unknown as Array<
    RetrievalEntryShape | { type: string }
  >;
  return entries.find((e): e is RetrievalEntryShape => e.type === "retrieval");
}

async function postRagMessage(
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
      overrides: { rag: { storages: [storageId], ...(mode ? { mode } : {}) } },
    },
  });
  expect(msgRes.ok()).toBeTruthy();
  return id;
}

test("overrides.rag runs retrieval before the planner; entry + planner prompt carry the hits", async ({
  request,
}) => {
  test.setTimeout(25_000);
  const agentId = await defaultAgentId(request);
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const storageId = await createStorage(request, `e2e-forced-${Date.now()}`, docs);
  try {
    const conversationId = await postRagMessage(request, agentId, storageId, DB_QUESTION);

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
    const conversationId = await postRagMessage(request, agentId, storageId, DB_QUESTION);

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

test("preplanned mode: a rag_planning thought composes the queries, retrieval records them as planned", async ({
  request,
}) => {
  test.setTimeout(25_000);
  const agentId = await defaultAgentId(request);
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const storageId = await createStorage(request, `e2e-preplanned-${Date.now()}`, docs);
  try {
    const conversationId = await postRagMessage(request, agentId, storageId, DB_QUESTION, "preplanned");

    await expect
      .poll(async () => (await retrievalEntryOf(request, conversationId))?.state ?? "missing", {
        timeout: 15_000,
      })
      .toBe("done");
    const entry = (await retrievalEntryOf(request, conversationId))!;
    // The stub planning reply (STUB_RAG_PLANNING_REPLY) is two planned queries.
    expect(entry.queries.map((q) => q.origin)).toEqual(["planned", "planned"]);
    expect(entry.queries[0]!.text).toBe("SQLite database migrations Prisma");
    expect(entry.hits.length).toBeGreaterThan(0);
    expect(entry.hits[0]!.source).toBe("db.md");

    // The planning thought is visible in the transcript, and the planner
    // still anchors after the retrieval entry (its prompt carries the hits).
    const entries = (await getConversationEntries(request, conversationId)) as unknown as StreamEntry[];
    const planning = entries.find((e) => e.type === "thought" && e.thoughtType === "rag_planning");
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

test("preview endpoint returns the hits and token estimate a send would inject", async ({ request }) => {
  test.setTimeout(25_000);
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const storageId = await createStorage(request, `e2e-forced-preview-${Date.now()}`, docs);
  try {
    const res = await request.post(`${apiBaseUrl()}/api/rag/retrieve/preview`, {
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

test("composer bar: toggle + storage chip preview the injection, send records it, and the draft resets", async ({
  app,
  request,
}) => {
  test.setTimeout(30_000);
  const agentId = await defaultAgentId(request);
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const name = `e2e-forced-ui-${Date.now()}`;
  const storageId = await createStorage(request, name, docs);
  try {
    await app.chat.gotoNew(agentId);

    // Enable forced retrieval and pick the storage in the bar above the input.
    await app.page.getByTestId("chat-rag-toggle").click();
    await app.page.locator(`[data-testid="chat-rag-storage"][data-storage-name="${name}"]`).click();

    // Live preview: typing runs the actual retrieval (debounced) and reports
    // what a send right now would inject.
    await app.chat.userInput.typeMessage(DB_QUESTION);
    const previewText = app.page.getByTestId("retrieval-preview");
    await expect(previewText).toContainText(/excerpts? · ~\d+ tok/, { timeout: 10_000 });

    await app.chat.userInput.send();

    const row = app.page.getByTestId("retrieval-row");
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId("retrieval-summary")).toContainText("Retrieved", { timeout: 15_000 });
    await row.getByRole("button").first().click();
    await expect(row.getByTestId("retrieval-hit-source").first()).toHaveText("db.md");
    await expect(row.getByTestId("retrieval-query-origin").first()).toHaveText("verbatim");

    // Single-shot: the toggle switched itself off after sending.
    await expect(app.page.getByTestId("chat-rag-toggle")).toHaveAttribute("aria-pressed", "false");
  } finally {
    await deleteStorage(request, storageId);
    await rm(docs, { recursive: true, force: true });
  }
});
