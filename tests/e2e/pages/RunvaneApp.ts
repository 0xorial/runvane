import { Page } from "@playwright/test";
import { ChatPage } from "./ChatPage";
import { Sidebar } from "./Sidebar";

export class RunvaneApp {
  readonly chat: ChatPage;
  readonly sidebar: Sidebar;

  constructor(readonly page: Page) {
    this.chat = new ChatPage(page);
    this.sidebar = new Sidebar(page);
  }
}
