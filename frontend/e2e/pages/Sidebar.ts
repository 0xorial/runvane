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
}
