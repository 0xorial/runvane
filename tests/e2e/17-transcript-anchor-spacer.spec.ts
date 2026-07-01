import { defaultAgentId, USER_MSG_HELLO } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("top-anchor spacer is recomputed (not left stale) when the viewport resizes", async ({
  app,
  request,
}) => {
  await app.page.setViewportSize({ width: 1280, height: 900 });
  await app.chat.gotoNew(await defaultAgentId(request));
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();

  // Build up enough prior history that the conversation's real content already
  // overflows the viewport — otherwise `min-h-full` alone stretches the content
  // to fill it and the spacer is trivially 0 regardless of viewport size.
  for (let i = 0; i < 5; i += 1) {
    await app.chat.userInput.typeMessage(`filler e2e message ${i}`);
    await app.chat.userInput.send();
    await app.chat.transcript.waitForAssistantMessageCount(i + 2);
  }

  const container = app.chat.transcript.container;
  const spacerHeight = () =>
    container.evaluate((el) => (el.lastElementChild as HTMLElement).getBoundingClientRect().height);

  // With content overflowing, the reserved spacer is driven by the viewport
  // height. The feature under test recomputes it on resize instead of leaving it
  // stale, so growing the viewport grows the spacer and shrinking it back shrinks
  // it. Assert only the DIRECTION of change — the exact pixel delta depends on
  // font/row metrics and would make this environment-fragile. `expect.poll` waits
  // for the resize-triggered recompute to settle (no fixed timeout).
  await expect.poll(spacerHeight).toBeGreaterThan(0);
  const atShort = await spacerHeight();

  await app.page.setViewportSize({ width: 1280, height: 1300 });
  await expect.poll(spacerHeight).toBeGreaterThan(atShort);
  const atTall = await spacerHeight();

  await app.page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(spacerHeight).toBeLessThan(atTall);
});
