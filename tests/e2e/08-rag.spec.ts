import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { RAG_PROBE_MESSAGE, apiBaseUrl, defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

/**
 * RAG end-to-end coverage through the running app (Playwright, stub-LLM mode).
 * Embeddings go through the stub provider (deterministic bag-of-words), so
 * ranking is stable without a live model. The test process and backend share
 * the container filesystem, so temp doc dirs are readable by the server.
 */

const DB_DOC = "SQLite database migrations are managed by Prisma. Run the migration to update the schema.";
const COOK_DOC = "A tomato basil pasta recipe: boil water, add salt, then cook the pasta.";
const NET_DOC = "TCP socket connections carry packets across the network with varying latency and throughput.";

async function makeDocs(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "e2e-rag-docs-"));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
  return dir;
}

/**
 * Graph fixtures: the stub extractor derives the knowledge graph from
 * `[[Entity]]` / `[[A]] --rel--> [[B]]` annotations in the docs themselves.
 * The B doc shares no query tokens with the A doc's topic, so only the graph
 * walk (Alpha Service → Beta Queue → its mentions) can surface it.
 */
const GRAPH_DOC_A =
  "The [[Alpha Service]] --publishes to--> [[Beta Queue]]. The alpha service handles ingress traffic and publishes work units.";
const GRAPH_DOC_B =
  "The [[Beta Queue]] --drains into--> [[Gamma Store]]. Consumers pull batches and persist them overnight.";

function storageCard(page: Page, name: string) {
  return page.locator(`[data-testid="rag-storage"][data-storage-name="${name}"]`);
}

/** Fill the create form and submit; returns the new storage's card locator. */
async function createStorage(
  page: Page,
  name: string,
  roots: string,
  opts: { graph?: boolean; watch?: boolean } = {},
) {
  await page.getByTestId("rag-name").fill(name);
  await page.getByTestId("rag-provider").fill("stub");
  await page.getByTestId("rag-model").fill("stub-embed");
  await page.getByTestId("rag-roots").fill(roots);
  if (opts.graph) {
    await page.getByTestId("rag-graph-builder").selectOption("llm");
    await page.getByTestId("rag-graph-provider").fill("stub");
    await page.getByTestId("rag-graph-model").fill("stub-graph");
  }
  if (opts.watch) await page.getByTestId("rag-watch").check();
  await page.getByTestId("rag-create").click();
  const card = storageCard(page, name);
  await expect(card).toBeVisible({ timeout: 10_000 });
  return card;
}

test("RAG: create a files storage, ingest, retrieve the closest doc, delete", async ({ app }) => {
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const name = `e2e-life-${Date.now()}`;
  try {
    await app.page.goto("/settings/rag");
    await expect(app.page.getByTestId("rag-section")).toBeVisible();
    const card = await createStorage(app.page, name, docs);

    await card.getByTestId("rag-ingest").click();
    await expect(card.getByTestId("rag-ingest-result")).toContainText("+2 added", { timeout: 10_000 });
    await expect(card.getByTestId("rag-storage-meta")).toContainText("2 chunks");

    await card.getByTestId("rag-query").fill("how do database migrations work in prisma");
    await card.getByTestId("rag-test").click();
    const top = card.getByTestId("rag-hit").first().getByTestId("rag-hit-source");
    await expect(top).toHaveText("db.md", { timeout: 10_000 });

    await card.getByTestId("rag-delete").click();
    await expect(card).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await rm(docs, { recursive: true, force: true });
  }
});

test("RAG: which document ranks first depends on the query", async ({ app }) => {
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC, "network.md": NET_DOC });
  const name = `e2e-rank-${Date.now()}`;
  try {
    await app.page.goto("/settings/rag");
    const card = await createStorage(app.page, name, docs);
    await card.getByTestId("rag-ingest").click();
    await expect(card.getByTestId("rag-storage-meta")).toContainText("3 chunks", { timeout: 10_000 });

    const top = card.getByTestId("rag-hit").first().getByTestId("rag-hit-source");

    await card.getByTestId("rag-query").fill("tomato basil pasta recipe boil water");
    await card.getByTestId("rag-test").click();
    await expect(top).toHaveText("cooking.md", { timeout: 10_000 });

    await card.getByTestId("rag-query").fill("tcp socket packets network latency");
    await card.getByTestId("rag-test").click();
    await expect(top).toHaveText("network.md", { timeout: 10_000 });

    await card.getByTestId("rag-delete").click();
  } finally {
    await rm(docs, { recursive: true, force: true });
  }
});

test("RAG: re-ingest skips unchanged files and re-embeds changed ones", async ({ app }) => {
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const name = `e2e-inc-${Date.now()}`;
  try {
    await app.page.goto("/settings/rag");
    const card = await createStorage(app.page, name, docs);

    await card.getByTestId("rag-ingest").click();
    await expect(card.getByTestId("rag-ingest-result")).toContainText("+2 added", { timeout: 10_000 });

    // Nothing changed -> both skipped.
    await card.getByTestId("rag-ingest").click();
    await expect(card.getByTestId("rag-ingest-result")).toContainText("2 skipped", { timeout: 10_000 });

    // Change one file on disk -> exactly one updated.
    await writeFile(path.join(docs, "db.md"), "Entirely new content about quantum entanglement and qubits.");
    await card.getByTestId("rag-ingest").click();
    await expect(card.getByTestId("rag-ingest-result")).toContainText("1 updated", { timeout: 10_000 });

    await card.getByTestId("rag-delete").click();
  } finally {
    await rm(docs, { recursive: true, force: true });
  }
});

test("RAG: a storage and its counts persist across a page reload", async ({ app }) => {
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });
  const name = `e2e-persist-${Date.now()}`;
  try {
    await app.page.goto("/settings/rag");
    const card = await createStorage(app.page, name, docs);
    await card.getByTestId("rag-ingest").click();
    await expect(card.getByTestId("rag-storage-meta")).toContainText("2 chunks", { timeout: 10_000 });

    await app.page.reload();
    await expect(app.page.getByTestId("rag-section")).toBeVisible();
    const reloaded = storageCard(app.page, name);
    await expect(reloaded).toBeVisible({ timeout: 10_000 });
    await expect(reloaded.getByTestId("rag-storage-meta")).toContainText("2 chunks");

    await reloaded.getByTestId("rag-delete").click();
  } finally {
    await rm(docs, { recursive: true, force: true });
  }
});

test("RAG graph: ingest extracts a graph; graph strategy pulls connected docs + context", async ({ app }) => {
  const docs = await makeDocs({ "graph-a.md": GRAPH_DOC_A, "graph-b.md": GRAPH_DOC_B });
  const name = `e2e-graph-${Date.now()}`;
  try {
    await app.page.goto("/settings/rag");
    await expect(app.page.getByTestId("rag-section")).toBeVisible();
    const card = await createStorage(app.page, name, docs, { graph: true });

    // Extraction runs during ingest: 3 entities, 2 relations across the docs.
    await card.getByTestId("rag-ingest").click();
    await expect(card.getByTestId("rag-ingest-result")).toContainText("+2 added", { timeout: 10_000 });
    await expect(card.getByTestId("rag-ingest-result")).toContainText("graph: 3 nodes / 2 edges");
    await expect(card.getByTestId("rag-storage-meta")).toContainText("graph (llm): 3 nodes / 2 edges");

    // topK=1 keeps the vector seed set to the lexically-matching doc alone, so
    // any second hit can only come from the graph walk.
    await card.getByTestId("rag-query").fill("alpha service ingress traffic");
    await card.getByTestId("rag-query-topk").fill("1");
    await card.getByTestId("rag-test").click();
    await expect(card.getByTestId("rag-hit").first().getByTestId("rag-hit-source")).toHaveText("graph-a.md", {
      timeout: 10_000,
    });
    await expect(card.locator('[data-testid="rag-hit"][data-hit-origin="graph"]')).toHaveCount(0);

    // Graph strategy: same query also surfaces graph-b.md via Beta Queue,
    // marked as a graph hit, with the traversed relations shown.
    await card.getByTestId("rag-query-graph").check();
    await card.getByTestId("rag-test").click();
    const graphHit = card.locator('[data-testid="rag-hit"][data-hit-origin="graph"]');
    await expect(graphHit).toHaveCount(1, { timeout: 10_000 });
    await expect(graphHit.getByTestId("rag-hit-source")).toHaveText("graph-b.md");
    await expect(card.getByTestId("rag-graph-context")).toBeVisible();
    const relations = card.getByTestId("rag-graph-relation");
    await expect(relations).toHaveCount(2);
    await expect(card.getByTestId("rag-graph-context")).toContainText("Alpha Service");
    await expect(card.getByTestId("rag-graph-context")).toContainText("publishes to");
    await expect(card.getByTestId("rag-graph-context")).toContainText("Gamma Store");

    await card.getByTestId("rag-delete").click();
    await expect(card).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await rm(docs, { recursive: true, force: true });
  }
});

test("RAG chat: the agent explores a base and adds sources via the rag tool", async ({ app, request }) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "e2e-rag-chatsrc-"));
  const put = async (rel: string, content: string) => {
    await mkdir(path.dirname(path.join(base, rel)), { recursive: true });
    await writeFile(path.join(base, rel), content);
  };
  const baseUrl = apiBaseUrl();
  const name = `e2e-chatsrc-${Date.now()}`;
  try {
    await put("docs/db.md", DB_DOC);
    await put("docs/cooking.md", COOK_DOC);
    await put("src/main.ts", "export const x = 1;");
    await put("node_modules/pkg/index.js", "module.exports = {};");

    // An empty storage the agent will grow from chat.
    const createRes = await request.post(`${baseUrl}/api/rag/storages`, {
      data: {
        name,
        entitySource: "files",
        embeddingProviderId: "stub",
        embeddingModel: "stub-embed",
        sourceParams: { roots: [] },
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const storage = (await createRes.json()) as { id: string };

    const agentId = await defaultAgentId(request);
    const agent = (await (await request.get(`${baseUrl}/api/agents/${agentId}`)).json()) as {
      name: string;
      default_llm_configuration: Record<string, unknown> | null;
    };
    const original = agent.default_llm_configuration ?? null;
    const tools = { ...((original?.tools as Record<string, unknown>) ?? {}) };
    tools.rag = {
      policy: "allow",
      rules: { storages: [storage.id], top_k: 8, strategy: "simple", allow_source_changes: true },
    };

    try {
      expect(
        (
          await request.put(`${baseUrl}/api/agents/${agentId}`, {
            data: { name: agent.name, default_llm_configuration: { ...(original ?? {}), tools } },
          })
        ).ok(),
      ).toBeTruthy();

      // The stub planner explores the base (suggest_sources), then adds
      // <base>/docs (add_source), then finalizes.
      await app.chat.gotoNew(agentId);
      await app.chat.userInput.typeMessage(`__rag_sources_probe__ base=${base} storage=${name} index the docs`);
      await app.chat.userInput.send();
      await expect(app.chat.transcript.assistantMessage).toContainText("indexed the docs folder", {
        timeout: 20_000,
      });
      await expect(app.chat.transcript.toolRow()).toContainText("rag");

      // The add_source ingest runs in the background — poll until the docs
      // (and only the docs: 2 files) are queryable.
      await expect
        .poll(
          async () => {
            const infos = (await (await request.get(`${baseUrl}/api/rag/storages`)).json()) as Array<{
              id: string;
              counts: { chunks: number; sources: number };
            }>;
            return infos.find((s) => s.id === storage.id)?.counts ?? null;
          },
          { timeout: 15_000 },
        )
        .toEqual({ chunks: 2, sources: 2, nodes: 0, edges: 0 });
    } finally {
      await request.put(`${baseUrl}/api/agents/${agentId}`, {
        data: { name: agent.name, default_llm_configuration: original },
      });
      await request.delete(`${baseUrl}/api/rag/storages/${storage.id}`);
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("RAG watch: a watched storage auto-indexes on source changes, no Ingest click", async ({ app }) => {
  const docs = await makeDocs({ "db.md": DB_DOC });
  const name = `e2e-watch-${Date.now()}`;
  try {
    await app.page.goto("/settings/rag");
    const card = await createStorage(app.page, name, docs, { watch: true });
    await expect(card.getByTestId("rag-watch-badge")).toBeVisible();

    // Starting a watcher catches up immediately: the initial index runs on
    // its own (visible in counts once the ingest task finishes).
    await expect(card.getByTestId("rag-storage-meta")).toContainText("1 chunks / 1 sources", {
      timeout: 15_000,
    });

    // A new file under the watched root triggers a debounced re-index.
    await writeFile(path.join(docs, "cooking.md"), COOK_DOC);
    await expect(card.getByTestId("rag-storage-meta")).toContainText("2 chunks / 2 sources", {
      timeout: 15_000,
    });

    // Unwatch: badge clears and the toggle flips.
    await card.getByTestId("rag-watch-toggle").click();
    await expect(card.getByTestId("rag-watch-badge")).toHaveCount(0, { timeout: 10_000 });

    await card.getByTestId("rag-delete").click();
    await expect(card).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await rm(docs, { recursive: true, force: true });
  }
});

test("RAG: the storage card shows live indexing state while a slow ingest runs", async ({ app }) => {
  // The delay marker slows the stub's graph-extraction reply, keeping the
  // ingest task alive long enough to observe the live state.
  const docs = await makeDocs({ "slow.md": `__stub_delay:2000__ ${GRAPH_DOC_A}` });
  const name = `e2e-livestate-${Date.now()}`;
  try {
    await app.page.goto("/settings/rag");
    const card = await createStorage(app.page, name, docs, { graph: true });

    await card.getByTestId("rag-ingest").click();
    await expect(card.getByTestId("rag-indexing")).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId("rag-ingest")).toBeDisabled();

    // The task finishes: live block clears, result + counts land.
    await expect(card.getByTestId("rag-indexing")).toHaveCount(0, { timeout: 15_000 });
    await expect(card.getByTestId("rag-ingest-result")).toContainText("+1 added");
    await expect(card.getByTestId("rag-storage-meta")).toContainText("1 chunks");

    await card.getByTestId("rag-delete").click();
  } finally {
    await rm(docs, { recursive: true, force: true });
  }
});

test("RAG graph: the rag tool uses the graph strategy in chat", async ({ app, request }) => {
  const base = apiBaseUrl();
  // The probe's stub query is 'database migration prisma'; annotate the DB doc
  // so the graph links it to a second doc the query alone would never rank.
  const docs = await makeDocs({
    "db.md": "[[Prisma]] --migrates--> [[SQLite Schema]]. " + DB_DOC,
    "ops.md": "The [[SQLite Schema]] --is backed up by--> [[Nightly Job]]. Cron dumps run at 03:00.",
  });

  const createRes = await request.post(`${base}/api/rag/storages`, {
    data: {
      name: `e2e-graph-chat-${Date.now()}`,
      entitySource: "files",
      embeddingProviderId: "stub",
      embeddingModel: "stub-embed",
      sourceParams: { roots: [docs] },
      graph: { builder: "llm", params: { providerId: "stub", model: "stub-graph" } },
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const storage = (await createRes.json()) as { id: string };
  const ingest = (await (await request.post(`${base}/api/rag/storages/${storage.id}/ingest`)).json()) as {
    graph: { nodes: number; edges: number; failedSources: number } | null;
  };
  expect(ingest.graph).toEqual({ nodes: 3, edges: 2, failedSources: 0 });

  const agentId = await defaultAgentId(request);
  const agent = (await (await request.get(`${base}/api/agents/${agentId}`)).json()) as {
    name: string;
    default_llm_configuration: Record<string, unknown> | null;
  };
  const original = agent.default_llm_configuration ?? null;
  const tools = { ...((original?.tools as Record<string, unknown>) ?? {}) };
  tools.rag = {
    policy: "allow",
    rules: { storages: [storage.id], top_k: 8, strategy: "graph", max_hops: 1 },
  };
  const nextCfg = { ...(original ?? {}), tools };

  try {
    expect(
      (
        await request.put(`${base}/api/agents/${agentId}`, {
          data: { name: agent.name, default_llm_configuration: nextCfg },
        })
      ).ok(),
    ).toBeTruthy();

    await app.chat.gotoNew(agentId);
    await app.chat.userInput.typeMessage(RAG_PROBE_MESSAGE);
    await app.chat.userInput.send();

    await app.chat.transcript.waitForToolState("done");
    await expect(app.chat.transcript.toolRow()).toContainText("rag");
    await expect(app.chat.transcript.assistantMessage).toContainText("Prisma migration", { timeout: 15_000 });
  } finally {
    await request.put(`${base}/api/agents/${agentId}`, {
      data: { name: agent.name, default_llm_configuration: original },
    });
    await request.delete(`${base}/api/rag/storages/${storage.id}`);
    await rm(docs, { recursive: true, force: true });
  }
});

test("RAG: an agent retrieves from a storage via the rag tool in chat", async ({ app, request }) => {
  const base = apiBaseUrl();
  const docs = await makeDocs({ "db.md": DB_DOC, "cooking.md": COOK_DOC });

  // Seed an ingested storage directly via the API.
  const createRes = await request.post(`${base}/api/rag/storages`, {
    data: {
      name: `e2e-chat-${Date.now()}`,
      entitySource: "files",
      embeddingProviderId: "stub",
      embeddingModel: "stub-embed",
      sourceParams: { roots: [docs] },
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const storage = (await createRes.json()) as { id: string };
  expect((await request.post(`${base}/api/rag/storages/${storage.id}/ingest`)).ok()).toBeTruthy();

  // Point the default agent's rag tool at the storage (policy: allow).
  const agentId = await defaultAgentId(request);
  const agent = (await (await request.get(`${base}/api/agents/${agentId}`)).json()) as {
    name: string;
    default_llm_configuration: Record<string, unknown> | null;
  };
  const original = agent.default_llm_configuration ?? null;
  const tools = { ...((original?.tools as Record<string, unknown>) ?? {}) };
  tools.rag = { policy: "allow", rules: { storages: [storage.id], top_k: 8, strategy: "simple" } };
  const nextCfg = { ...(original ?? {}), tools };

  try {
    const putRes = await request.put(`${base}/api/agents/${agentId}`, {
      data: { name: agent.name, default_llm_configuration: nextCfg },
    });
    expect(putRes.ok()).toBeTruthy();

    // Ground-truth: the rag tool is actually enabled on the agent post-PUT.
    const verify = (await (await request.get(`${base}/api/agents/${agentId}`)).json()) as {
      default_llm_configuration?: { tools?: { rag?: { policy?: string } } };
    };
    expect(verify.default_llm_configuration?.tools?.rag?.policy).toBe("allow");

    await app.chat.gotoNew(agentId);
    await app.chat.userInput.typeMessage(RAG_PROBE_MESSAGE);
    await app.chat.userInput.send();

    // The planner calls the rag tool, it runs, and the conversation finalizes.
    await app.chat.transcript.waitForToolState("done");
    await expect(app.chat.transcript.toolRow()).toContainText("rag");
    await expect(app.chat.transcript.assistantMessage).toContainText("Prisma migration", { timeout: 15_000 });
  } finally {
    await request.put(`${base}/api/agents/${agentId}`, {
      data: { name: agent.name, default_llm_configuration: original },
    });
    await request.delete(`${base}/api/rag/storages/${storage.id}`);
    await rm(docs, { recursive: true, force: true });
  }
});
