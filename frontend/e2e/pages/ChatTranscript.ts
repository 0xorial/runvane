import { expect, Locator, Page } from "@playwright/test";
import { E2E_LLM_TIMEOUT_MS, E2E_UI_TIMEOUT_MS } from "../timeouts";

export class ChatTranscript {
  constructor(private readonly root: Page | Locator) {}

  get container(): Locator {
    return this.root.getByTestId("chat-transcript");
  }

  get loading(): Locator {
    return this.root.getByTestId("chat-loading");
  }

  entry(type: string): Locator {
    return this.root.locator(`[data-chat-entry-type="${type}"]`);
  }

  get userMessage(): Locator {
    return this.entry("user-message").first();
  }

  get assistantMessage(): Locator {
    return this.entry("assistant-message").last();
  }

  async waitForUserMessage(timeoutMs = E2E_UI_TIMEOUT_MS): Promise<void> {
    await expect(this.loading).toBeHidden({ timeout: timeoutMs });
    await expect(this.userMessage).toBeVisible({ timeout: timeoutMs });
  }

  async waitForAssistantReply(timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<void> {
    await expect(this.loading).toBeHidden({ timeout: timeoutMs });
    await expect(this.assistantMessage).toBeVisible({ timeout: timeoutMs });
    await expect(this.assistantMessage).not.toHaveText(/^\s*$/);
  }
}
