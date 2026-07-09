import { expect, Locator, Page } from "@playwright/test";
import { PROBE_MESSAGE, STUB_SUMMARIZE_REPLY } from "../harness/client";
import { E2E_LLM_TIMEOUT_MS, E2E_UI_TIMEOUT_MS } from "../timeouts";

export const PROBE_EXPECTED_ENTRY_TYPES = [
  "user-message",
  "thought-prepare", // title (side lane, anchored at the user message)
  "thought-prepare", // decision planning
  "assistant-message",
  // The tool entry is pre-created on the spine at dispatch; the params
  // resolution runs as a side thought anchored to it, so it renders after.
  "tool-invocation",
  "thought-prepare", // resolve tool parameters (side lane)
  "thought-prepare", // decision planning (continuation, anchored at the batch tail)
  "assistant-message",
] as const;

export const PROBE_EXPECTED_PREPARE_TITLES = [
  "Title generation",
  "Decision planning",
  "Resolve tool parameters",
  "Decision planning",
] as const;

export type ProbeTranscriptSnapshot = {
  entryTypes: string[];
  prepareTitles: string[];
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

  get branchSelectors(): Locator {
    return this.container.getByTestId("branch-selector");
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

  /** Probe stub: tool call + two assistant rows — don't snapshot after the first assistant only. */
  async waitForProbeComplete(timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<void> {
    await expect(this.loading).toBeHidden({ timeout: timeoutMs });
    await expect(this.entry("tool-invocation")).toBeVisible({ timeout: timeoutMs });
    await expect(this.entry("assistant-message")).toHaveCount(2, { timeout: timeoutMs });
    await expect(this.assistantMessage).not.toHaveText(/^\s*$/);
  }

  private entryRows(): Locator {
    return this.container.locator("[data-chat-entry-type]");
  }

  async expectNoBranchSelectors(): Promise<void> {
    await expect(this.branchSelectors).toHaveCount(0);
  }

  async snapshotProbeTranscript(timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<ProbeTranscriptSnapshot> {
    await this.waitForProbeComplete(timeoutMs);
    const rows = this.entryRows();
    const count = await rows.count();
    const entryTypes: string[] = [];
    const prepareTitles: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      const type = await row.getAttribute("data-chat-entry-type");
      if (!type) throw new Error("transcript row missing data-chat-entry-type");
      entryTypes.push(type);
      if (type === "thought-prepare") {
        const title = await row.getAttribute("data-chat-prepare-title");
        if (!title) throw new Error(`thought-prepare row ${i} missing data-chat-prepare-title`);
        prepareTitles.push(title);
      }
    }
    return {
      entryTypes,
      prepareTitles,
      userText: (await this.userMessage.innerText()).trim(),
      assistantText: (await this.assistantMessage.innerText()).trim(),
    };
  }

  /** Probe: correct row order, no spurious sibling branches in the transcript. */
  async expectProbeSequence(timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<ProbeTranscriptSnapshot> {
    const snap = await this.snapshotProbeTranscript(timeoutMs);
    expect(snap.entryTypes).toEqual([...PROBE_EXPECTED_ENTRY_TYPES]);
    expect(snap.prepareTitles).toEqual([...PROBE_EXPECTED_PREPARE_TITLES]);
    expect(snap.userText).toContain(PROBE_MESSAGE);
    expect(snap.assistantText.length).toBeGreaterThan(0);
    await this.expectNoBranchSelectors();
    return snap;
  }

  async waitForUserMessageCount(count: number, timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<void> {
    await expect(this.loading).toBeHidden({ timeout: timeoutMs });
    await expect(this.entry("user-message")).toHaveCount(count, { timeout: timeoutMs });
  }

  async waitForAssistantMessageCount(count: number, timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<void> {
    await expect(this.loading).toBeHidden({ timeout: timeoutMs });
    await expect(this.entry("assistant-message")).toHaveCount(count, { timeout: timeoutMs });
  }

  async foldFromUserMessage(index: number): Promise<void> {
    const row = this.entry("user-message").nth(index);
    await expect(row).toBeVisible();
    await row.getByTestId("fold-from-here").click();
  }

  async splitFromUserMessage(index: number): Promise<void> {
    const row = this.entry("user-message").nth(index);
    await expect(row).toBeVisible();
    await row.getByTestId("split-from-here").click();
  }

  async waitForCheckpointSummary(
    expectedText: string = STUB_SUMMARIZE_REPLY,
    timeoutMs = E2E_LLM_TIMEOUT_MS,
  ): Promise<void> {
    await expect(this.loading).toBeHidden({ timeout: timeoutMs });
    const summary = this.entry("checkpoint-summary").last();
    await expect(summary).toBeVisible({ timeout: timeoutMs });
    await expect(summary).toContainText(expectedText, { timeout: timeoutMs });
  }

  async expectTranscriptContains(text: string): Promise<void> {
    await expect(this.container).toContainText(text);
  }

  async expectTranscriptNotContains(text: string): Promise<void> {
    await expect(this.container).not.toContainText(text);
  }

  prepareRow(title: string, index = 0): Locator {
    return this.container
      .locator(`[data-chat-entry-type="thought-prepare"][data-chat-prepare-title="${title}"]`)
      .nth(index);
  }

  /** The right-hand details panel a collapsed thought/tool row opens into. */
  get detailPanel(): Locator {
    return this.root.getByTestId("entry-detail-panel");
  }

  /** Click a finished (collapsed) thought row to open its details panel. */
  async openThoughtDetails(prepareTitle: string, index = 0): Promise<void> {
    await this.prepareRow(prepareTitle, index).getByTestId("thought-collapsed-row").click();
    await expect(this.detailPanel).toBeVisible();
  }

  async expectThoughtPanel(stage: "context" | "reasoning" | "action"): Promise<void> {
    await expect(
      this.detailPanel.locator(`[data-testid="thought-step-panel"][data-thought-stage="${stage}"]`),
    ).toBeVisible();
  }

  async waitForBranchSelectors(minCount = 1, timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<void> {
    await expect(this.branchSelectors).toHaveCount(minCount, { timeout: timeoutMs });
  }

  toolRow(index = 0): Locator {
    return this.container.getByTestId("tool-invocation-row").nth(index);
  }

  async waitForToolState(
    state: "requested" | "running" | "done" | "error" | "denied",
    index = 0,
    timeoutMs = E2E_LLM_TIMEOUT_MS,
  ): Promise<void> {
    await expect(this.toolRow(index)).toHaveAttribute("data-tool-state", state, { timeout: timeoutMs });
  }

  userMessageRow(index = 0): Locator {
    return this.entry("user-message").nth(index);
  }

  async waitForPrepareTitle(title: string, timeoutMs = E2E_LLM_TIMEOUT_MS): Promise<void> {
    await expect(this.prepareRow(title)).toBeVisible({ timeout: timeoutMs });
  }
}
