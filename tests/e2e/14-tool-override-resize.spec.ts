import type { Locator, Page } from "@playwright/test";
import { defaultAgentId } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("expected element to have a bounding box");
  return box;
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
}

// The custom-rules popup ("Custom · <tool>") hosts a rules editor whose height
// is owned by its own drag handle, independent of the popup's size. Resizing
// the popup must not change the editor's height; the editor's width must keep
// following the popup (container) width.
test("custom-rules popup: editor height is its own drag handle, decoupled from popup size", async ({
  app,
  page,
  request,
}) => {
  test.setTimeout(45_000);
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);

  // Open the custom-rules popup for the first tool in the chat tools panel.
  const toolsPanel = page.getByTestId("chat-tools-panel");
  await expect(toolsPanel).toBeVisible();
  const firstControl = toolsPanel.getByRole("group", { name: "Tool override mode" }).first();
  await expect(firstControl).toBeVisible({ timeout: 15_000 });
  await firstControl.getByRole("button", { name: "Custom" }).click();

  const popup = page.getByTestId("chat-tool-override-editor");
  await expect(popup).toBeVisible();

  // Wait for Monaco to mount so the measured heights are stable.
  await expect(popup.locator(".monaco-editor").first()).toBeVisible({ timeout: 20_000 });
  const editor = popup.getByTestId("code-editor").first();
  const handle = popup.getByRole("separator", { name: "Resize editor height" });
  await expect(handle).toBeVisible();

  const editor0 = await boxOf(editor);
  const popup0 = await boxOf(popup);

  // 1) The drag handle below the editor changes ONLY the editor height. Width
  //    follows the container (unchanged here) and the popup itself stays put.
  const h0 = await boxOf(handle);
  await dragBy(page, { x: h0.x + h0.width / 2, y: h0.y + h0.height / 2 }, 0, 90);
  const editor1 = await boxOf(editor);
  const popup1 = await boxOf(popup);
  expect(editor1.height).toBeGreaterThan(editor0.height + 70);
  expect(editor1.height).toBeLessThan(editor0.height + 110);
  expect(Math.abs(editor1.width - editor0.width)).toBeLessThanOrEqual(3);
  expect(Math.abs(popup1.height - popup0.height)).toBeLessThanOrEqual(3);
  expect(Math.abs(popup1.width - popup0.width)).toBeLessThanOrEqual(3);

  // 2) Resizing the popup (shorter) does NOT change the editor height.
  const south = { x: popup1.x + popup1.width / 2, y: popup1.y + popup1.height - 4 };
  await dragBy(page, south, 0, -80);
  const popup2 = await boxOf(popup);
  const editor2 = await boxOf(editor);
  expect(popup2.height).toBeLessThan(popup1.height - 40); // popup actually shrank
  expect(Math.abs(editor2.height - editor1.height)).toBeLessThanOrEqual(6); // editor height held

  // 3) Width still follows the container: widening the popup widens the editor,
  //    while its height stays put.
  const east = { x: popup2.x + popup2.width - 4, y: popup2.y + popup2.height / 2 };
  await dragBy(page, east, 120, 0);
  const popup3 = await boxOf(popup);
  const editor3 = await boxOf(editor);
  expect(popup3.width).toBeGreaterThan(popup2.width + 60); // popup widened
  expect(editor3.width).toBeGreaterThan(editor2.width + 60); // editor width followed
  expect(Math.abs(editor3.height - editor2.height)).toBeLessThanOrEqual(6); // height held
});
