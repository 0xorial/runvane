import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

/**
 * Drives the full RAG feature through the UI: create a files-backed storage,
 * ingest it, and run a semantic query — asserting the database doc ranks above
 * the cooking doc. Embeddings go through the stub provider (deterministic
 * bag-of-words), so the ranking is stable without a live model. The test and
 * backend share the container filesystem, so the temp docs dir is readable by
 * the server.
 */
test("RAG: create a files storage, ingest, and retrieve the closest doc", async ({ app }) => {
  const docsDir = await mkdtemp(path.join(os.tmpdir(), "e2e-rag-docs-"));
  await writeFile(
    path.join(docsDir, "db.md"),
    "SQLite database migrations are managed by Prisma. Run the migration to update the schema.",
  );
  await writeFile(
    path.join(docsDir, "cooking.md"),
    "A tomato basil pasta recipe: boil water, add salt, then cook the pasta.",
  );

  const storageName = `e2e-rag-${Date.now()}`;
  const card = app.page.locator(`[data-testid="rag-storage"][data-storage-name="${storageName}"]`);

  try {
    await app.page.goto("/settings/rag");
    await expect(app.page.getByTestId("rag-section")).toBeVisible();

    // Create a storage. Embeddings route through the stub provider in e2e mode.
    await app.page.getByTestId("rag-name").fill(storageName);
    await app.page.getByTestId("rag-provider").fill("stub");
    await app.page.getByTestId("rag-model").fill("stub-embed");
    await app.page.getByTestId("rag-roots").fill(docsDir);
    await app.page.getByTestId("rag-create").click();
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Ingest, then confirm the two docs landed as chunks.
    await card.getByTestId("rag-ingest").click();
    await expect(card.getByTestId("rag-ingest-result")).toContainText("+2 added", { timeout: 10_000 });
    await expect(card.getByTestId("rag-storage-meta")).toContainText("2 chunks");

    // Semantic query: the database doc should rank first, not the recipe.
    await card.getByTestId("rag-query").fill("how do database migrations work in prisma");
    await card.getByTestId("rag-test").click();
    const firstHit = card.getByTestId("rag-hit").first();
    await expect(firstHit).toBeVisible({ timeout: 10_000 });
    await expect(firstHit.getByTestId("rag-hit-source")).toHaveText("db.md");

    // Clean up the storage through the UI so the test is self-contained.
    await card.getByTestId("rag-delete").click();
    await expect(card).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await rm(docsDir, { recursive: true, force: true });
  }
});
