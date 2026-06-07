import { defaultAgentId } from "./api/client";
import { expect, test } from "./fixtures";

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

test("composer agent toolbar enables send without manual ?agent= URL", async ({ app, request }) => {
  await app.page.goto("/chat/new");
  await expect(app.chat.userInput.textarea).toBeVisible();
  const send = app.chat.userInput.sendButton;
  await expect(send).toBeDisabled();
  await app.chat.userInput.typeMessage("hello from layout test");
  await expect(send).toBeEnabled({ timeout: 10_000 });
  void request;
});

test("settings navigation from chat title panel", async ({ app, request }) => {
  const agentId = await defaultAgentId(request);
  await app.chat.gotoNew(agentId);
  await app.page.getByTestId("open-settings").click();
  await expect(app.page).toHaveURL(/\/settings\//);
  await expect(app.page.getByRole("heading", { name: "Agents" })).toBeVisible();
});
