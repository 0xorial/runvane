import { Page } from "@playwright/test";
import { ChatTranscript } from "./ChatTranscript";
import { UserInput } from "./UserInput";

export class ChatPage {
  readonly userInput: UserInput;
  readonly transcript: ChatTranscript;

  constructor(private readonly page: Page) {
    this.userInput = new UserInput(page);
    this.transcript = new ChatTranscript(page);
  }

  async gotoNew(agentId: string): Promise<void> {
    await this.page.goto(`/chat/new?agent=${encodeURIComponent(agentId)}`, { waitUntil: "domcontentloaded" });
  }

  async open(conversationId: string): Promise<void> {
    await this.page.goto(`/chat/${encodeURIComponent(conversationId)}`, { waitUntil: "domcontentloaded" });
  }

  conversationIdFromUrl(): string {
    const match = this.page.url().match(/\/chat\/([^/?#]+)/);
    if (!match?.[1] || match[1] === "new") {
      throw new Error(`ChatPage.open: expected /chat/:id in URL, got ${this.page.url()}`);
    }
    return match[1];
  }
}
