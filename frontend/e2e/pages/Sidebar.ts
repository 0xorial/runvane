import { Locator, Page } from "@playwright/test";

export class Sidebar {
  constructor(private readonly page: Page) {}

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
}
