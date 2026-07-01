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
  NO_PARAMS_RESOLUTION_MARKER,
  NO_PARAMS_RESOLUTION_TOOL,
  STUB_NO_PARAMS_RESOLUTION_REPLY,
} from '../../../backend/src/llmProviders/providers/stubLlm.helpers.js';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

const STEP_TIMEOUT = 15_000;

type ToolInvocationRow = ChatEntryRow & { parameters?: Record<string, unknown> };

/**
 * Proves that a tool's `separate_params_resolution` flag actually changes
 * runtime behavior: when off, the planner's own (already-structured) tool
 * request becomes the tool's params directly; when on (the default), the
 * separate tool-params resolver runs and — per the stub's fixed reply for an
 * unrecognized tool — always produces `{}`, discarding whatever the planner
 * sent. See stubLlm.helpers.ts's NO_PARAMS_RESOLUTION_* scenario.
 */
describeLive('tool param resolution is configurable (integration)', () => {
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

  async function startProbe(overrides: unknown): Promise<string> {
    const conversationId = await createConversation(baseUrl);
    await postConversationMessage(
      baseUrl,
      conversationId,
      defaultAgentId,
      `${NO_PARAMS_RESOLUTION_MARKER} run the mock tool`,
      { overrides },
    );
    return conversationId;
  }

  async function waitForToolInvocation(conversationId: string): Promise<ToolInvocationRow> {
    return pollUntil(
      async () => {
        const entries = await listAllMessages(baseUrl, conversationId);
        const tool = entries.find(
          (e): e is ToolInvocationRow => e.type === 'tool-invocation' && e.toolId === NO_PARAMS_RESOLUTION_TOOL,
        );
        return tool ?? null;
      },
      `${NO_PARAMS_RESOLUTION_TOOL} tool-invocation entry`,
      STEP_TIMEOUT,
    );
  }

  async function waitFinalAnswer(conversationId: string): Promise<void> {
    await pollUntil(
      async () => {
        const entries = await listAllMessages(baseUrl, conversationId);
        return entries.some(
          (e) => e.type === 'assistant-message' && String(e.text ?? '').includes(STUB_NO_PARAMS_RESOLUTION_REPLY),
        )
          ? true
          : null;
      },
      'final assistant message',
      STEP_TIMEOUT,
    );
  }

  it('separate_params_resolution: false uses the planner tool request as params directly', async () => {
    const conversationId = await startProbe({
      tools: { [NO_PARAMS_RESOLUTION_TOOL]: { policy: 'allow', separate_params_resolution: false } },
    });

    const tool = await waitForToolInvocation(conversationId);
    expect(tool.parameters?.probe).toBe('direct-from-planner');

    controller.complete(NO_PARAMS_RESOLUTION_TOOL);
    await waitFinalAnswer(conversationId);
  }, 30_000);

  it('separate_params_resolution unset (default true) resolves params via the LLM step, discarding the planner JSON', async () => {
    const conversationId = await startProbe({
      tools: { [NO_PARAMS_RESOLUTION_TOOL]: { policy: 'allow' } },
    });

    const tool = await waitForToolInvocation(conversationId);
    expect(tool.parameters?.probe).toBeUndefined();

    controller.complete(NO_PARAMS_RESOLUTION_TOOL);
    await waitFinalAnswer(conversationId);
  }, 30_000);
});
