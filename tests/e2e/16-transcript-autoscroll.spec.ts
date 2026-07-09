import { Locator } from "@playwright/test";
import { defaultAgentId, GUARDED_AGENT_ID, PROBE_MESSAGE, USER_MSG_HELLO } from "./harness/client";
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

// A tool that parks in `requested` renders EXPANDED (approval affordances +
// arguments block) — tall content landing around the send-time align. The
// align's smooth scroll fires ordinary scroll events on its way to the
// anchor; deriving stickiness from those transient frames used to detach the
// bottom-follow permanently, so growth arriving after the align (streaming
// deltas, the expanded card) stayed below the fold.
test("bottom-follow survives the send-align: post-align growth stays visible", async ({ app }) => {
  await app.page.setViewportSize({ width: 1280, height: 500 });
  await app.chat.gotoNew(GUARDED_AGENT_ID);
  await app.chat.userInput.typeMessage(PROBE_MESSAGE);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForToolState("requested");

  const container = app.chat.transcript.container;
  const tool = app.chat.transcript.toolRow();
  await expect(tool.getByTestId("tool-approve-button")).toBeVisible();
  // Let the send-align animation finish (bounded: ≤~500ms start + 200ms run).
  await app.page.waitForTimeout(800);

  // Post-align growth (streaming deltas, a tool card expanding) first
  // consumes the align's reserved spacer, then the follow pins the bottom.
  // With follow-state corrupted around the align — the historical bug — this
  // growth ends below the fold instead.
  const spacer = await container.evaluate((el) =>
    Math.round((el.lastElementChild as HTMLElement).getBoundingClientRect().height),
  );
  await growContentBy(container, spacer + 300);

  await expect
    .poll(() => container.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight), {
      timeout: 5_000,
    })
    .toBeLessThanOrEqual(8);

  // The reservation must have been consumed by the real content, so the
  // pinned bottom is the true bottom.
  await expect
    .poll(() =>
      container.evaluate((el) => (el.lastElementChild as HTMLElement).getBoundingClientRect().height),
    )
    .toBeLessThanOrEqual(1);
});

test("reloading a conversation lands at the bottom without re-running the send-time anchoring", async ({
  app,
  request,
}) => {
  await app.page.setViewportSize({ width: 1280, height: 900 });
  await app.chat.gotoNew(await defaultAgentId(request));
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();
  // A second message anchors above existing content, so its reserved spacer is
  // non-zero (for the very first message anchorTop is 0 and so is the spacer).
  await app.chat.userInput.typeMessage("second message before reload");
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantMessageCount(2);

  const container = app.chat.transcript.container;
  const spacerHeight = () =>
    container.evaluate((el) => (el.lastElementChild as HTMLElement).getBoundingClientRect().height);
  // Sending anchored the message to the top and reserved a spacer below the reply.
  await expect.poll(spacerHeight).toBeGreaterThan(0);

  await app.page.reload({ waitUntil: "domcontentloaded" });
  await app.chat.transcript.waitForAssistantReply();
  // Give a would-be align (the old derived-anchor bug) time to fire before asserting.
  await app.page.waitForTimeout(600);

  expect(await spacerHeight()).toBe(0);
  await expect
    .poll(() => container.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(8);
});

test("switching conversations lands at the bottom, not at the other chat's last user message", async ({
  app,
  request,
}) => {
  await app.page.setViewportSize({ width: 1280, height: 500 });
  const agentId = await defaultAgentId(request);

  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();
  await app.chat.userInput.typeMessage("filler e2e switch-target message");
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantMessageCount(2);
  const firstConversationId = app.chat.conversationIdFromUrl();

  await app.chat.gotoNew(agentId);
  await app.chat.userInput.typeMessage("second conversation message");
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();

  // Client-side switch back to the first conversation (no page load).
  await app.sidebar.openConversation(firstConversationId);
  await app.chat.transcript.waitForUserMessageCount(2);
  await app.page.waitForTimeout(600);

  const container = app.chat.transcript.container;
  const spacer = await container.evaluate((el) =>
    (el.lastElementChild as HTMLElement).getBoundingClientRect().height,
  );
  expect(spacer).toBe(0);
  await expect
    .poll(() => container.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(8);
});

test("viewport resizes while at the bottom keep the bottom pinned instead of scrolling back to the anchor", async ({
  app,
  request,
}) => {
  await app.page.setViewportSize({ width: 1280, height: 900 });
  await app.chat.gotoNew(await defaultAgentId(request));
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();
  await app.page.waitForTimeout(600); // let the send-time align settle

  const container = app.chat.transcript.container;
  const distanceToBottom = () =>
    container.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

  // Real overflow past the anchor, user reads at the true bottom.
  await growContentBy(container, 2000);
  await container.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await app.page.waitForTimeout(200);

  // Two resizes: the first also flushes the stale spacer; the second used to hit
  // the settled-spacer path and smooth-scroll all the way back to the anchor.
  await app.page.setViewportSize({ width: 1280, height: 600 });
  await expect.poll(distanceToBottom).toBeLessThanOrEqual(8);
  await app.page.setViewportSize({ width: 1280, height: 500 });
  await app.page.waitForTimeout(600);
  await expect.poll(distanceToBottom).toBeLessThanOrEqual(8);
});

test("sending a message aligns it to the top of the viewport even after scrolling away", async ({
  app,
  request,
}) => {
  await app.page.setViewportSize({ width: 1280, height: 900 });
  await app.chat.gotoNew(await defaultAgentId(request));
  await app.chat.userInput.typeMessage(USER_MSG_HELLO);
  await app.chat.userInput.send();
  await app.chat.transcript.waitForAssistantReply();
  // Real prior history (synthetic divs would land BELOW newly inserted rows in
  // the DOM, distorting the anchor position of the message under test).
  for (let i = 0; i < 4; i += 1) {
    await app.chat.userInput.typeMessage(`filler e2e align message ${i}`);
    await app.chat.userInput.send();
    await app.chat.transcript.waitForAssistantMessageCount(i + 2);
  }

  const container = app.chat.transcript.container;
  await container.evaluate((el) => {
    el.scrollTop = 0;
  });
  await app.page.waitForTimeout(200);

  await app.chat.userInput.typeMessage("final message after scrolling away");
  await app.chat.userInput.send();

  // The align event scrolls down from the top to the freshly sent message,
  // surviving the optimistic-row → server-id rekey.
  await expect
    .poll(() => container.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(300);
  // Let the 200ms scroll animation finish before measuring the anchor position.
  await app.page.waitForTimeout(500);
  const anchorDelta = await container.evaluate((el) => {
    const rows = el.querySelectorAll<HTMLElement>('[data-chat-entry-type="user-message"]');
    const last = rows[rows.length - 1];
    return last.getBoundingClientRect().top - el.getBoundingClientRect().top;
  });
  // At (or scrolled past) the viewport top — never still hundreds of px below it.
  expect(anchorDelta).toBeLessThanOrEqual(48);
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
