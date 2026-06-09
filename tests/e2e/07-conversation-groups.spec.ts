import {
  createConversation,
  defaultAgentId,
  getConversation,
  listConversations,
  moveConversationToGroup,
} from "./harness/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("sidebar creates a new group and moves conversation into it", async ({ app, request }) => {
  test.setTimeout(15_000);
  const agentId = await defaultAgentId(request);
  const groupName = `e2e new group ${Date.now()}`;
  const title = `e2e create group ${Date.now()}`;
  const conversationId = await createConversation(request, title);

  await app.chat.gotoNew(agentId);
  await expect(app.sidebar.conversationButton(conversationId)).toBeVisible();

  await app.sidebar.moveConversationToNewGroup(conversationId, groupName);
  await expect
    .poll(async () => (await getConversation(request, conversationId)).groupId)
    .not.toBeNull();
  await expect
    .poll(async () =>
      (await listConversations(request)).groups.some((group) => group.name === groupName),
    )
    .toBe(true);
  await expect
    .poll(async () => app.sidebar.groupHeader(groupName).isVisible(), { timeout: 10_000 })
    .toBe(true);
  await app.sidebar.expectConversationInGroup(conversationId, groupName);
});

test("sidebar moves conversation into an existing group", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  const groupName = `e2e existing group ${Date.now()}`;
  const firstId = await createConversation(request, `e2e grouped ${Date.now()}`);
  const secondId = await createConversation(request, `e2e mover ${Date.now()}`);

  const grouped = await moveConversationToGroup(request, firstId, { newGroupName: groupName });
  expect(grouped.groupId).toBeTruthy();

  await app.chat.open(secondId);
  await expect(app.sidebar.conversationButton(secondId)).toBeVisible();

  await app.sidebar.moveConversationToExistingGroup(secondId, groupName);
  await expect
    .poll(async () => (await getConversation(request, secondId)).groupId)
    .toBe((await getConversation(request, firstId)).groupId);
  await app.sidebar.expectConversationInGroup(secondId, groupName);
  await app.sidebar.expectConversationInGroup(firstId, groupName);

  const first = await getConversation(request, firstId);
  const second = await getConversation(request, secondId);
  expect(second.groupId).toBe(first.groupId);
});
