import { expect, Locator, Page } from "@playwright/test";

export class Sidebar {
  constructor(private readonly page: Page) {}

  private conversationRow(conversationId: string): Locator {
    return this.page.locator(`[data-conversation-row][data-conversation-id="${conversationId}"]`);
  }

  private moveToGroupEntry(): Locator {
    return this.page
      .getByRole("menuitem", { name: "Move to group" })
      .or(this.page.getByRole("button", { name: "Move to group" }));
  }

  private moveToGroupMenu(): Locator {
    return this.page.getByRole("menu").filter({ hasText: "No group" });
  }

  private moveToGroupTarget(name: string | RegExp): Locator {
    const menu = this.moveToGroupMenu();
    return menu.getByRole("menuitem", { name }).or(menu.getByRole("button", { name }));
  }

  get newChatButton(): Locator {
    return this.page.getByTestId("sidebar-new-chat");
  }

  get probeTimeButton(): Locator {
    return this.page.getByTestId("sidebar-probe-time");
  }

  async clickNewChat(): Promise<void> {
    await this.newChatButton.click();
  }

  async runProbeTime(): Promise<void> {
    await this.probeTimeButton.click();
    await this.page.waitForURL((url) => {
      const id = url.pathname.match(/\/chat\/([^/]+)/)?.[1];
      return id != null && id !== "new";
    });
  }

  conversationButton(conversationId: string): Locator {
    return this.page.getByTestId(`sidebar-conversation-${conversationId}`);
  }

  async openConversation(conversationId: string): Promise<void> {
    const button = this.conversationButton(conversationId);
    await button.waitFor({ state: "visible" });
    await button.click();
    await this.page.waitForURL(
      new RegExp(`/chat/${conversationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[/?#]|$)`),
    );
  }

  async openConversationMenu(conversationId: string): Promise<void> {
    const row = this.conversationRow(conversationId);
    await row.waitFor({ state: "visible" });
    await row.getByRole("button", { name: "Chat menu" }).click();
    await this.page.getByRole("menu").first().waitFor({ state: "visible" });
  }

  private async openMoveToGroupSubmenu(conversationId: string): Promise<void> {
    await this.openConversationMenu(conversationId);
    const moveEntry = this.moveToGroupEntry();
    await moveEntry.hover();
    const newGroup = this.moveToGroupTarget(/New group/);
    try {
      await newGroup.waitFor({ state: "visible", timeout: 1_500 });
    } catch {
      await moveEntry.click();
      await newGroup.waitFor({ state: "visible" });
    }
  }

  async moveConversationToNewGroup(conversationId: string, groupName: string): Promise<void> {
    await this.openMoveToGroupSubmenu(conversationId);
    await this.moveToGroupTarget(/New group/).click();
    const dialog = this.page.getByRole("dialog", { name: "New group" });
    await dialog.waitFor({ state: "visible" });
    const input = dialog.locator("input").first();
    await input.click();
    await input.fill(groupName);
    await expect(input).toHaveValue(groupName);

    const putDone = this.page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(`/api/conversations/${encodeURIComponent(conversationId)}`) &&
        response.ok(),
    );
    await dialog.getByRole("button", { name: /^Create/ }).click();
    await putDone;
    await dialog.waitFor({ state: "hidden" });
  }

  async moveConversationToExistingGroup(conversationId: string, groupName: string): Promise<void> {
    await this.openMoveToGroupSubmenu(conversationId);
    const putDone = this.page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes(`/api/conversations/${encodeURIComponent(conversationId)}`) &&
        response.ok(),
    );
    await this.moveToGroupTarget(groupName).click();
    await putDone;
    await this.moveToGroupMenu().waitFor({ state: "hidden" });
  }

  groupHeader(groupName: string): Locator {
    return this.page.locator(`[data-sidebar-group-name="${groupName}"]`);
  }

  async expectConversationInGroup(conversationId: string, groupName: string): Promise<void> {
    const header = this.groupHeader(groupName);
    await expect(header).toBeVisible({ timeout: 10_000 });
    const row = this.conversationRow(conversationId);
    if (!(await row.isVisible())) {
      await header.click();
    }
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toHaveClass(/ml-3/);
  }
}
