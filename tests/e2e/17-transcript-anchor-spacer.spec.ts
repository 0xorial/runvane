import { defaultAgentId, USER_MSG_HELLO } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("bottom spacer is recalculated when the viewport resizes", async ({ app, request }) => {
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
  // Let the align loop (triggered by sending the last message) settle so the
  // spacer reflects a stable position.
  await app.page.waitForTimeout(600);

  const container = app.chat.transcript.container;
  const spacerHeight = () =>
    container.evaluate((el) => (el.lastElementChild as HTMLElement).getBoundingClientRect().height);

  const before = await spacerHeight();
  expect(before).toBeGreaterThan(0);

  await app.page.setViewportSize({ width: 1280, height: 1300 });
  await expect.poll(spacerHeight).toBeGreaterThan(before + 300);
});
