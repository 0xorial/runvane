import { expect, Locator, Page } from "@playwright/test";
import { PROBE_MESSAGE } from "../api/client";
import { E2E_LLM_TIMEOUT_MS, E2E_UI_TIMEOUT_MS } from "../timeouts";

export const PROBE_EXPECTED_ENTRY_TYPES = [
  "user-message",
  "thought-prepare",
  "thought-prepare",
  "assistant-message",
] as const;

export const PROBE_EXPECTED_PREPARE_TITLES = ["Title generation", "Decision planning"] as const;

export type ProbeTranscriptSnapshot = {
  entryTypes: string[];
  prepareTitles: string[];
  parentIds: string[];
  userText: string;
  assistantText: string;
};

export class ChatTranscript {
  constructor(private readonly root: Page | Locator) {}

  get container(): Locator {
    return this.root.getByTestId("chat-transcript");
  }

  get loading(): Locator {
    return this.root.getByTestId("chat-loading");
  }

  entry(type: string): Locator {
    return this.container.locator(`[data-chat-entry-type="${type}"]`);
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

  private entryRows(): Locator {
    return this.container.locator("[data-chat-entry-type]");
  }

  async snapshotProbeTranscript(timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<ProbeTranscriptSnapshot> {
    await this.waitForAssistantReply(timeoutMs);
    const rows = this.entryRows();
    const count = await rows.count();
    const entryTypes: string[] = [];
    const prepareTitles: string[] = [];
    const parentIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const type = await row.getAttribute("data-chat-entry-type");
      if (!type) throw new Error("transcript row missing data-chat-entry-type");
      entryTypes.push(type);
      parentIds.push((await row.getAttribute("data-chat-parent-id")) ?? "");
      if (type === "thought-prepare") {
        const title = await row.getAttribute("data-chat-prepare-title");
        if (!title) throw new Error(`thought-prepare row ${i} missing data-chat-prepare-title`);
        prepareTitles.push(title);
      }
    }
    return {
      entryTypes,
      prepareTitles,
      parentIds,
      userText: (await this.userMessage.innerText()).trim(),
      assistantText: (await this.assistantMessage.innerText()).trim(),
    };
  }

  async expectProbeSequence(timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<ProbeTranscriptSnapshot> {
    const snap = await this.snapshotProbeTranscript(timeoutMs);
    expect(snap.entryTypes).toEqual([...PROBE_EXPECTED_ENTRY_TYPES]);
    expect(snap.prepareTitles).toEqual([...PROBE_EXPECTED_PREPARE_TITLES]);
    expect(snap.userText).toContain(PROBE_MESSAGE);
    expect(snap.assistantText.length).toBeGreaterThan(0);
    return snap;
  }
}
