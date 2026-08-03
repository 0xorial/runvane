import { defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

// Expanding a tool in agent settings shows the "clear view" — how the tool
// works, derived from its schema + rules: operations, typed parameters, Safety,
// Limits, Policy, and a raw-schema escape hatch. The collapsed row carries
// effect tags (blast radius) at a glance.
test("agent settings: a tool's clear view explains how it works", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.page.goto(`/settings/agents?agent=${encodeURIComponent(agentId)}`, {
    waitUntil: "domcontentloaded",
  });

  const target = app.page.getByTestId("tool-section-target");
  const row = target.locator("tr").filter({ has: app.page.locator('code:text-is("filesystem_write")') }).first();
  await expect(row).toBeVisible();

  // Effect tags are visible on the row before expanding: writes, and delete off.
  const tags = row.getByTestId("tool-effect-tags");
  await expect(tags).toContainText("writes");
  await expect(tags).toContainText("deletes off");

  // Enable the tool, then expand it.
  await row.getByRole("group", { name: "filesystem_write permission policy" }).getByRole("button", { name: "Allow" }).click();
  await target.locator('button:has(code:text-is("filesystem_write"))').click();

  const view = app.page.getByTestId("tool-clear-view");
  await expect(view).toBeVisible();

  // Operations rendered as chips, not JSON.
  const ops = view.getByTestId("clear-view-operations");
  for (const op of ["write", "replace", "edit", "mkdir", "move", "delete"]) {
    await expect(ops.locator(`code:text-is("${op}")`)).toBeVisible();
  }

  // Parameters as a typed field list.
  const params = view.getByTestId("clear-view-params");
  await expect(params.locator('code:text-is("file_hash")')).toBeVisible();
  await expect(params.locator('code:text-is("offset")')).toBeVisible();

  // Safety facet surfaces the roots + gates; Limits the scalars.
  const safety = view.getByTestId("clear-view-safety");
  await expect(safety.locator('code:text-is("writable_roots")')).toBeVisible();
  await expect(safety.locator('code:text-is("allow_delete")')).toBeVisible();
  await expect(view.getByTestId("clear-view-limits").locator('code:text-is("max_write_bytes")')).toBeVisible();

  // Raw-schema escape hatch is present.
  await expect(view.locator("summary", { hasText: "Raw schema" })).toBeVisible();
});
