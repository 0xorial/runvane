import { retainSharedTestApp } from '../support/shared-app';
import {
  type ChatEntryRow,
  createConversation,
  getDefaultAgentId,
  listAllMessages,
  pollUntil,
  postConversationMessage,
} from '../support/http';
import { MockToolController, registerMockTools } from '../support/mock-tool';
import {
  DIRECT_BAD_PARAMS_MARKER,
  DIRECT_ENVELOPE_ECHO_MARKER,
  NO_PARAMS_RESOLUTION_TOOL,
  STUB_DIRECT_BAD_PARAMS_REPLY,
} from '../../../backend/src/llmProviders/providers/stubLlm.helpers.js';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

const STEP_TIMEOUT = 15_000;

type ToolInvocationRow = ChatEntryRow & {
  state?: string;
  parameters?: Record<string, unknown>;
  result?: { error?: string | null } | null;
};

/**
 * Direct dispatch (separate_params_resolution off) must survive a model that
 * echoes runvane's own stored bookkeeping keys back in its arguments (they are
 * stripped, the tool runs clean), and a genuinely rejected dispatch must leave
 * a VISIBLE error entry and let the planner finish instead of silently
 * replanning in a loop.
 */
describeLive('tool direct dispatch (integration)', () => {
  let baseUrl: string;
  let defaultAgentId: string;
  const controller = new MockToolController();

  beforeAll(async () => {
    const app = await retainSharedTestApp();
    baseUrl = app.baseUrl;
    registerMockTools(app.app, controller);
    defaultAgentId = await getDefaultAgentId(baseUrl);
  }, 30_000);

  beforeEach(() => {
    controller.reset();
  });

  async function waitForTool(
    conversationId: string,
    toolId: string,
    predicate: (tool: ToolInvocationRow) => boolean,
  ): Promise<ToolInvocationRow> {
    return pollUntil(
      async () => {
        const entries = await listAllMessages(baseUrl, conversationId);
        const tool = entries.find(
          (e): e is ToolInvocationRow => e.type === 'tool-invocation' && e.toolId === toolId,
        );
        return tool && predicate(tool) ? tool : null;
      },
      `${toolId} tool-invocation`,
      STEP_TIMEOUT,
    );
  }

  it('strips model-echoed internal envelope keys and runs the tool with clean args', async () => {
    const conversationId = await createConversation(baseUrl);
    await postConversationMessage(baseUrl, conversationId, defaultAgentId, `${DIRECT_ENVELOPE_ECHO_MARKER} run it`, {
      overrides: {
        tools: {
          [NO_PARAMS_RESOLUTION_TOOL]: { policy: 'allow', separate_params_resolution: false },
        },
      },
    });
    controller.complete(NO_PARAMS_RESOLUTION_TOOL, { ok: true });

    const done = await waitForTool(conversationId, NO_PARAMS_RESOLUTION_TOOL, (t) => t.state === 'done');

    // The tool saw only its real argument — none of the echoed bookkeeping keys.
    expect(controller.receivedParams(NO_PARAMS_RESOLUTION_TOOL)).toEqual([{ probe: 'envelope-echo' }]);

    // The stored entry re-stamps OUR envelope; the model-echoed junk string
    // must not have survived as the batch ref.
    const batch = done.parameters?.__tool_batch as { id?: string } | undefined;
    expect(batch && typeof batch).toBe('object');
    expect(batch?.id).not.toBe('model-echoed');
  }, 30_000);

  it('surfaces a rejected direct dispatch as a visible error entry and still finishes the run', async () => {
    const conversationId = await createConversation(baseUrl);
    await postConversationMessage(baseUrl, conversationId, defaultAgentId, `${DIRECT_BAD_PARAMS_MARKER} run it`, {
      overrides: {
        tools: {
          get_current_time: { policy: 'allow', separate_params_resolution: false },
        },
      },
    });

    const failed = await waitForTool(conversationId, 'get_current_time', (t) => t.state === 'error');
    expect(failed.result?.error).toMatch(/rejected|bogus|unrecognized/i);

    // The planner saw the failed call in its next context and finalized —
    // no silent replanning loop.
    await pollUntil(
      async () => {
        const entries = await listAllMessages(baseUrl, conversationId);
        const finalAnswer = entries.find(
          (e) => e.type === 'assistant-message' && String((e as { text?: string }).text ?? '').includes(STUB_DIRECT_BAD_PARAMS_REPLY),
        );
        return finalAnswer ?? null;
      },
      'final assistant answer after failed dispatch',
      STEP_TIMEOUT,
    );
  }, 30_000);
});
