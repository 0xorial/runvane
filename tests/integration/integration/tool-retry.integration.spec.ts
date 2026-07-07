import { retainSharedTestApp } from '../support/shared-app';
import {
  type ChatEntryRow,
  createConversation,
  getDefaultAgentId,
  listAllMessages,
  pollUntil,
  postConversationMessage,
  retryToolInvocation,
} from '../support/http';
import { MockToolController, registerMockTools } from '../support/mock-tool';
import {
  NO_PARAMS_RESOLUTION_MARKER,
  NO_PARAMS_RESOLUTION_TOOL,
} from '../../../backend/src/llmProviders/providers/stubLlm.helpers.js';
import { ToolRunsRepo } from '../../../backend/src/db/repositories/tool-runs.repo.js';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

const STEP_TIMEOUT = 15_000;

type ToolInvocationRow = ChatEntryRow & {
  state?: string;
  attempt?: number;
  result?: { error?: string | null } | null;
};

/**
 * Retry on a failed tool run: the entry re-runs in place (`error → running →
 * done`) and the tool_runs table keeps one immutable row per attempt with the
 * retry lineage. Terminal-but-not-failed entries must reject the retry.
 */
describeLive('tool retry (integration)', () => {
  let baseUrl: string;
  let toolRuns: ToolRunsRepo;
  let defaultAgentId: string;
  const controller = new MockToolController();

  beforeAll(async () => {
    const app = await retainSharedTestApp();
    baseUrl = app.baseUrl;
    registerMockTools(app.app, controller);
    toolRuns = app.app.get(ToolRunsRepo);
    defaultAgentId = await getDefaultAgentId(baseUrl);
  }, 30_000);

  beforeEach(() => {
    controller.reset();
  });

  async function waitForTool(
    conversationId: string,
    predicate: (tool: ToolInvocationRow) => boolean,
  ): Promise<ToolInvocationRow> {
    return pollUntil(
      async () => {
        const entries = await listAllMessages(baseUrl, conversationId);
        const tool = entries.find(
          (e): e is ToolInvocationRow => e.type === 'tool-invocation' && e.toolId === NO_PARAMS_RESOLUTION_TOOL,
        );
        return tool && predicate(tool) ? tool : null;
      },
      `${NO_PARAMS_RESOLUTION_TOOL} tool-invocation`,
      STEP_TIMEOUT,
    );
  }

  it('re-runs a failed tool in place and records the attempt lineage', async () => {
    const conversationId = await createConversation(baseUrl);
    await postConversationMessage(baseUrl, conversationId, defaultAgentId, `${NO_PARAMS_RESOLUTION_MARKER} run it`, {
      overrides: {
        tools: {
          [NO_PARAMS_RESOLUTION_TOOL]: { policy: 'allow', separate_params_resolution: false },
        },
      },
    });

    controller.fail(NO_PARAMS_RESOLUTION_TOOL, 'transient boom');
    const failed = await waitForTool(conversationId, (t) => t.state === 'error');
    expect(failed.result?.error).toContain('transient boom');

    // The controller's release gate is one-shot per tool name and is already
    // resolved with the failure — reset so the retried run gets a fresh gate.
    controller.reset();
    controller.complete(NO_PARAMS_RESOLUTION_TOOL, { ok: true, after: 'retry' });
    const res = await retryToolInvocation(baseUrl, conversationId, failed.id);
    expect(res.status).toBe(202);

    const done = await waitForTool(conversationId, (t) => t.id === failed.id && t.state === 'done');
    expect(done.id).toBe(failed.id); // same transcript row, re-run in place
    expect(done.attempt).toBe(2); // the retry is visible on the entry itself

    const runs = await toolRuns.listForEntry(conversationId, failed.id);
    expect(runs.map((r) => ({ attempt: r.attempt, status: r.status }))).toEqual([
      { attempt: 1, status: 'error' },
      { attempt: 2, status: 'done' },
    ]);
    expect(runs[1].retryOfRunId).toBe(runs[0].id);
    expect(runs[0].error).toContain('transient boom');
  }, 30_000);

  it('rejects retrying an entry that did not fail', async () => {
    const conversationId = await createConversation(baseUrl);
    await postConversationMessage(baseUrl, conversationId, defaultAgentId, `${NO_PARAMS_RESOLUTION_MARKER} run it`, {
      overrides: {
        tools: {
          [NO_PARAMS_RESOLUTION_TOOL]: { policy: 'allow', separate_params_resolution: false },
        },
      },
    });
    controller.complete(NO_PARAMS_RESOLUTION_TOOL);
    const done = await waitForTool(conversationId, (t) => t.state === 'done');

    const res = await retryToolInvocation(baseUrl, conversationId, done.id);
    expect(res.status).toBe(400);
  }, 30_000);
});
