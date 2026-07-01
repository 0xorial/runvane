import { Locator } from "@playwright/test";
import { defaultAgentId, USER_MSG_HELLO } from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

/** Append a synthetic block to the transcript content, simulating a new chat entry arriving. */
async function growContentBy(container: Locator, px: number): Promise<void> {
  await container.evaluate((el, height) => {
    const content = el.firstElementChild as HTMLElement;
    const div = document.createElement("div");
    div.style.height = `${height}px`;
    content.appendChild(div);
  }, px);
}

test("transcript follows new content to the bottom when the user is already at the bottom", async ({
  app,
  request,
}) => {
  await app.chat.gotoNew(await defaultAgentId(request));
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();

  const container = app.chat.transcript.container;
  await container.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await growContentBy(container, 600);

  await expect
    .poll(() => container.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(8);
});

test("transcript leaves the scroll position alone once the user has scrolled away from the bottom", async ({
  app,
  request,
}) => {
  await app.chat.gotoNew(await defaultAgentId(request));
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();
  // Let the top-anchor alignment (triggered by sending the message) finish its
  // own scroll animation before we simulate the user manually scrolling away.
  await app.page.waitForTimeout(600);

  const container = app.chat.transcript.container;
  // Pad the transcript so the viewport genuinely overflows: with everything
  // visible, "top" and "bottom" are the same position and the test proves nothing.
  await growContentBy(container, 2000);
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  await app.page.waitForTimeout(200);
  const before = await container.evaluate((el) => el.scrollTop);
  expect(before).toBe(0);

  await growContentBy(container, 600);
  await app.page.waitForTimeout(200);

  const after = await container.evaluate((el) => el.scrollTop);
  expect(after).toBe(before);
});
