import { retainSharedTestApp } from '../support/shared-app';
import {
  type ChatEntryRow,
  approveToolInvocation,
  createConversation,
  getDefaultAgentId,
  listAllMessages,
  pollUntil,
  postConversationMessage,
} from '../support/http';
import { MockToolController, registerMockTools } from '../support/mock-tool';
import {
  NO_PARAMS_RESOLUTION_MARKER,
  NO_PARAMS_RESOLUTION_TOOL,
} from '../../../backend/src/llmProviders/providers/stubLlm.helpers.js';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

const STEP_TIMEOUT = 15_000;

type ToolInvocationRow = ChatEntryRow & {
  parameters?: Record<string, unknown>;
  originalParameters?: Record<string, unknown>;
  parametersEdited?: boolean;
  state?: string;
};

/**
 * Approve-with-edits: a `requested` tool invocation can be approved with
 * user-edited parameters. The run must use the edits, and the entry must keep
 * the model's original params plus an explicit edited flag — the transcript
 * has to make pre-edited calls obvious.
 */
describeLive('tool approval with edited parameters (integration)', () => {
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

  it('runs the edited params, keeps the originals, and flags the entry as edited', async () => {
    const conversationId = await createConversation(baseUrl);
    // separate_params_resolution off → planner JSON becomes the params
    // ({probe: 'direct-from-planner'}); policy 'ask' parks it as `requested`.
    await postConversationMessage(baseUrl, conversationId, defaultAgentId, `${NO_PARAMS_RESOLUTION_MARKER} run it`, {
      overrides: {
        tools: {
          [NO_PARAMS_RESOLUTION_TOOL]: { policy: 'ask', separate_params_resolution: false },
        },
      },
    });

    const requested = await waitForTool(conversationId, (t) => t.state === 'requested');
    expect(requested.parameters?.probe).toBe('direct-from-planner');
    expect(requested.parametersEdited).toBeUndefined();

    await approveToolInvocation(baseUrl, conversationId, requested.id, { probe: 'edited-by-user' });
    controller.complete(NO_PARAMS_RESOLUTION_TOOL);

    const done = await waitForTool(conversationId, (t) => t.state === 'done');
    // The run used the user's params…
    expect(done.parameters?.probe).toBe('edited-by-user');
    // …the model's request is preserved…
    expect(done.originalParameters).toEqual({ probe: 'direct-from-planner' });
    // …and the edit is explicit on the entry.
    expect(done.parametersEdited).toBe(true);
  }, 30_000);

  it('approving with unchanged params does not mark the entry edited', async () => {
    const conversationId = await createConversation(baseUrl);
    await postConversationMessage(baseUrl, conversationId, defaultAgentId, `${NO_PARAMS_RESOLUTION_MARKER} run it`, {
      overrides: {
        tools: {
          [NO_PARAMS_RESOLUTION_TOOL]: { policy: 'ask', separate_params_resolution: false },
        },
      },
    });
    const requested = await waitForTool(conversationId, (t) => t.state === 'requested');

    // The UI sends params even when the user opened the editor and changed
    // nothing — identical params must not be recorded as an edit.
    await approveToolInvocation(baseUrl, conversationId, requested.id, { probe: 'direct-from-planner' });
    controller.complete(NO_PARAMS_RESOLUTION_TOOL);

    const done = await waitForTool(conversationId, (t) => t.state === 'done');
    expect(done.parametersEdited).toBeUndefined();
    expect(done.originalParameters).toBeUndefined();
  }, 30_000);
});
