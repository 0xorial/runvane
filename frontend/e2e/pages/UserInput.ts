import { Locator, Page } from "@playwright/test";

export class UserInput {
  constructor(private readonly root: Page | Locator) {}

  get textarea(): Locator {
    return this.root.getByTestId("chat-user-input");
  }

  get sendButton(): Locator {
    return this.root.getByTestId("chat-send-button");
  }

  get attachButton(): Locator {
    return this.root.getByRole("button", { name: "Attach files" });
  }

  async typeMessage(text: string): Promise<void> {
    await this.textarea.fill(text);
  }

  async send(): Promise<void> {
    await this.sendButton.click();
  }
}
