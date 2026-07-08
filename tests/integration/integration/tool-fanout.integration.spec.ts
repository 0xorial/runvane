import { retainSharedTestApp } from '../support/shared-app';
import {
  approveToolInvocation,
  type ChatEntryRow,
  createConversation,
  denyToolInvocation,
  getAgentIdByName,
  getDefaultAgentId,
  listAllMessages,
  pollUntil,
  postConversationMessage,
  walkParentChain,
} from '../support/http';
import { MockToolController, registerMockTools } from '../support/mock-tool';
import {
  MOCK_FANOUT_MARKER,
  MOCK_FANOUT_TOOL_NAMES,
  STUB_MOCK_FANOUT_REPLY,
} from '../../../backend/src/llmProviders/providers/stubLlm.helpers.js';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

// Generous deadline: a fan-out is several stub round-trips plus polling.
const STEP_TIMEOUT = 15_000;
const PLANNER_TITLE = 'Decision planning';
const [TOOL_A, TOOL_B, TOOL_C] = MOCK_FANOUT_TOOL_NAMES;

type Allowed = 'always' | 'ask' | 'never';

/**
 * These tests exercise the tool fan-out fan-in invariant: when the planner
 * requests several tools in one decision, it must resume EXACTLY ONCE, and only
 * after every tool has reached a terminal state (done / error / denied). A
 * controllable mock tool lets each spec decide the resolution order and outcome
 * without relying on real timers; the planner is observed via its
 * `thought-prepare` entries ("Decision planning"), of which there must be two —
 * the initial fan-out and the single continuation.
 */
describeLive('tool fan-out fan-in (integration)', () => {
  let baseUrl: string;
  let defaultAgentId: string;
  let guardedAgentId: string;
  const controller = new MockToolController();

  beforeAll(async () => {
    const app = await retainSharedTestApp();
    baseUrl = app.baseUrl;
    registerMockTools(app.app, controller);
    defaultAgentId = await getDefaultAgentId(baseUrl);
    guardedAgentId = await getAgentIdByName(baseUrl, 'e2e guarded');
  }, 30_000);

  beforeEach(() => {
    controller.reset();
  });

  // --- helpers ---------------------------------------------------------------

  const POLICY_BY_ALLOWED = { always: 'allow', ask: 'ask', never: 'off' } as const;

  function toolOverrides(allowed: Allowed, guardrailFor?: string): unknown {
    return {
      tools: Object.fromEntries(
        MOCK_FANOUT_TOOL_NAMES.map((name) => [
          name,
          { policy: POLICY_BY_ALLOWED[allowed], guardrail: name === guardrailFor },
        ]),
      ),
    };
  }

  async function startFanout(
    agentId: string,
    overrides: unknown,
    llm?: { providerId: string; model: string },
  ): Promise<string> {
    const conversationId = await createConversation(baseUrl);
    await postConversationMessage(baseUrl, conversationId, agentId, `${MOCK_FANOUT_MARKER} run the mock tools`, {
      overrides,
      ...(llm ? { llm } : {}),
    });
    return conversationId;
  }

  const plannerCount = (entries: ChatEntryRow[]): number =>
    entries.filter((e) => e.type === 'thought-prepare' && e.title === PLANNER_TITLE).length;

  const findTool = (entries: ChatEntryRow[], name: string): ChatEntryRow | undefined =>
    entries.find((e) => e.type === 'tool-invocation' && e.toolId === name);

  async function expectPlannerRanOnce(conversationId: string): Promise<void> {
    const entries = await listAllMessages(baseUrl, conversationId);
    expect(plannerCount(entries)).toBe(1);
  }

  async function waitToolState(conversationId: string, name: string, state: string): Promise<ChatEntryRow> {
    return pollUntil(
      async () => {
        const tool = findTool(await listAllMessages(baseUrl, conversationId), name);
        return tool?.state === state ? tool : null;
      },
      `${name} → ${state}`,
      STEP_TIMEOUT,
    );
  }

  async function waitRequested(conversationId: string, name: string): Promise<ChatEntryRow> {
    return waitToolState(conversationId, name, 'requested');
  }

  async function waitFinalAnswer(conversationId: string): Promise<ChatEntryRow[]> {
    return pollUntil(
      async () => {
        const entries = await listAllMessages(baseUrl, conversationId);
        const done = entries.some(
          (e) => e.type === 'assistant-message' && String(e.text ?? '').includes(STUB_MOCK_FANOUT_REPLY),
        );
        return done ? entries : null;
      },
      'final assistant message',
      STEP_TIMEOUT,
    );
  }

  /** Release an already-executing tool and wait for its terminal state. */
  async function resolveExecuting(conversationId: string, name: string, outcome: 'ok' | 'fail'): Promise<void> {
    if (outcome === 'ok') controller.complete(name);
    else controller.fail(name);
    await waitToolState(conversationId, name, outcome === 'ok' ? 'done' : 'error');
  }

  /** Approve a requested tool, then let its (now executing) mock body complete. */
  async function approveAndComplete(conversationId: string, name: string, entryId: string): Promise<void> {
    await approveToolInvocation(baseUrl, conversationId, entryId);
    await controller.waitForStart(name);
    controller.complete(name);
    await waitToolState(conversationId, name, 'done');
  }

  // --- scenario 1: all complete --------------------------------------------

  it('3-tool fan-out, all complete → planner resumes once after the last completes', async () => {
    const conversationId = await startFanout(defaultAgentId, toolOverrides('always'));

    // All three tools begin executing and block on the controller.
    await Promise.all(MOCK_FANOUT_TOOL_NAMES.map((n) => controller.waitForStart(n)));
    await expectPlannerRanOnce(conversationId);

    await resolveExecuting(conversationId, TOOL_A, 'ok');
    await expectPlannerRanOnce(conversationId); // 1/3 done — planner must NOT resume yet
    await resolveExecuting(conversationId, TOOL_B, 'ok');
    await expectPlannerRanOnce(conversationId); // 2/3 done — still not yet
    await resolveExecuting(conversationId, TOOL_C, 'ok'); // 3/3 — now it resumes

    const entries = await waitFinalAnswer(conversationId);
    expect(plannerCount(entries)).toBe(2);
    for (const name of MOCK_FANOUT_TOOL_NAMES) expect(findTool(entries, name)?.state).toBe('done');
  }, 60_000);

  // --- scenario 2: one fails (failing tool resolves 1st / 2nd / 3rd) --------

  describe('3-tool fan-out, one fails', () => {
    const orders: Array<{ label: string; order: Array<{ name: string; outcome: 'ok' | 'fail' }> }> = [
      {
        label: 'failure resolves first',
        order: [
          { name: TOOL_A, outcome: 'fail' },
          { name: TOOL_B, outcome: 'ok' },
          { name: TOOL_C, outcome: 'ok' },
        ],
      },
      {
        label: 'failure resolves second',
        order: [
          { name: TOOL_A, outcome: 'ok' },
          { name: TOOL_B, outcome: 'fail' },
          { name: TOOL_C, outcome: 'ok' },
        ],
      },
      {
        label: 'failure resolves third',
        order: [
          { name: TOOL_A, outcome: 'ok' },
          { name: TOOL_B, outcome: 'ok' },
          { name: TOOL_C, outcome: 'fail' },
        ],
      },
    ];

    it.each(orders)('still resumes the planner exactly once ($label)', async ({ order }) => {
      const conversationId = await startFanout(defaultAgentId, toolOverrides('always'));
      await Promise.all(MOCK_FANOUT_TOOL_NAMES.map((n) => controller.waitForStart(n)));
      await expectPlannerRanOnce(conversationId);

      for (let i = 0; i < order.length; i++) {
        await resolveExecuting(conversationId, order[i].name, order[i].outcome);
        if (i < order.length - 1) await expectPlannerRanOnce(conversationId);
      }

      const entries = await waitFinalAnswer(conversationId);
      expect(plannerCount(entries)).toBe(2);
      for (const step of order) {
        expect(findTool(entries, step.name)?.state).toBe(step.outcome === 'ok' ? 'done' : 'error');
      }
    }, 60_000);
  });

  // --- scenario 3: one guardrail flags (flagged tool resolves 1st/2nd/3rd) --

  describe('3-tool fan-out, one guardrail flags then is approved', () => {
    // TOOL_A carries the guardrail; vary WHERE its resolution lands.
    const positions: Array<{ label: string; order: string[] }> = [
      { label: 'guarded tool resolves first', order: [TOOL_A, TOOL_B, TOOL_C] },
      { label: 'guarded tool resolves second', order: [TOOL_B, TOOL_A, TOOL_C] },
      { label: 'guarded tool resolves third', order: [TOOL_B, TOOL_C, TOOL_A] },
    ];

    it.each(positions)('resumes once after the flagged tool is resolved ($label)', async ({ order }) => {
      const conversationId = await startFanout(guardedAgentId, toolOverrides('always', TOOL_A));

      // The two un-guarded tools execute and block; the guarded one is flagged
      // by the guardrail and parks in `requested` awaiting approval.
      await controller.waitForStart(TOOL_B);
      await controller.waitForStart(TOOL_C);
      const guarded = await waitRequested(conversationId, TOOL_A);
      await expectPlannerRanOnce(conversationId);

      for (let i = 0; i < order.length; i++) {
        const name = order[i];
        if (name === TOOL_A) await approveAndComplete(conversationId, TOOL_A, guarded.id);
        else await resolveExecuting(conversationId, name, 'ok');
        if (i < order.length - 1) await expectPlannerRanOnce(conversationId);
      }

      const entries = await waitFinalAnswer(conversationId);
      expect(plannerCount(entries)).toBe(2);
      for (const name of MOCK_FANOUT_TOOL_NAMES) expect(findTool(entries, name)?.state).toBe('done');
    }, 60_000);
  });

  // --- scenario 4: all require approval, all approved -----------------------

  it('3-tool fan-out, all require approval → resumes once after the last approval', async () => {
    const conversationId = await startFanout(defaultAgentId, toolOverrides('ask'));

    // None execute yet; all three park in `requested`.
    const ids: Record<string, string> = {};
    for (const name of MOCK_FANOUT_TOOL_NAMES) ids[name] = (await waitRequested(conversationId, name)).id;
    await expectPlannerRanOnce(conversationId);

    const order = [TOOL_A, TOOL_B, TOOL_C];
    for (let i = 0; i < order.length; i++) {
      await approveAndComplete(conversationId, order[i], ids[order[i]]);
      if (i < order.length - 1) await expectPlannerRanOnce(conversationId);
    }

    const entries = await waitFinalAnswer(conversationId);
    expect(plannerCount(entries)).toBe(2);
    for (const name of MOCK_FANOUT_TOOL_NAMES) expect(findTool(entries, name)?.state).toBe('done');
  }, 60_000);

  // --- scenario 5: all require approval, denied (1st / 2nd / 3rd) -----------

  describe('3-tool fan-out, one approval denied', () => {
    // Fixed resolution order A → B → C; vary which position is denied (the rest
    // are approved). A denial is a terminal resolution, so the planner must
    // still resume exactly once, after the last tool settles.
    const cases: Array<{ label: string; denyIndex: number }> = [
      { label: 'denial resolves first', denyIndex: 0 },
      { label: 'denial resolves second', denyIndex: 1 },
      { label: 'denial resolves third', denyIndex: 2 },
    ];

    it.each(cases)('counts the denial as resolved; planner resumes once ($label)', async ({ denyIndex }) => {
      const conversationId = await startFanout(defaultAgentId, toolOverrides('ask'));

      const ids: Record<string, string> = {};
      for (const name of MOCK_FANOUT_TOOL_NAMES) ids[name] = (await waitRequested(conversationId, name)).id;
      await expectPlannerRanOnce(conversationId);

      const order = [TOOL_A, TOOL_B, TOOL_C];
      for (let i = 0; i < order.length; i++) {
        const name = order[i];
        if (i === denyIndex) {
          await denyToolInvocation(baseUrl, conversationId, ids[name]);
          await waitToolState(conversationId, name, 'denied');
        } else {
          await approveAndComplete(conversationId, name, ids[name]);
        }
        if (i < order.length - 1) await expectPlannerRanOnce(conversationId);
      }

      const entries = await waitFinalAnswer(conversationId);
      expect(plannerCount(entries)).toBe(2);
      expect(findTool(entries, order[denyIndex])?.state).toBe('denied');
      for (const name of MOCK_FANOUT_TOOL_NAMES) {
        if (name !== order[denyIndex]) expect(findTool(entries, name)?.state).toBe('done');
      }
    }, 60_000);
  });

  // --- scenario 7: approval order vs chain order (the rv-stable fork) -------

  describe('chain stays linear whatever order approvals settle', () => {
    /** Spine fork check: no entry may have more than one spine child. */
    function expectLinearSpine(entries: ChatEntryRow[]): void {
      const spineChildren = new Map<string | null, ChatEntryRow[]>();
      for (const e of entries) {
        if (e.isSide) continue;
        const list = spineChildren.get(e.parentId) ?? [];
        list.push(e);
        spineChildren.set(e.parentId, list);
      }
      const forks = [...spineChildren.entries()]
        .filter(([, children]) => children.length > 1)
        .map(
          ([parentId, children]) =>
            `${parentId ?? '<root>'} → [${children.map((c) => `${c.type}:${c.id.slice(0, 8)}`).join(', ')}]`,
        );
      expect(forks).toEqual([]);
    }

    it('members settle in REVERSE chain order → one continuation, anchored at the batch tail', async () => {
      const conversationId = await startFanout(defaultAgentId, toolOverrides('ask'));

      const ids: Record<string, string> = {};
      for (const name of MOCK_FANOUT_TOOL_NAMES) ids[name] = (await waitRequested(conversationId, name)).id;
      await expectPlannerRanOnce(conversationId);

      // Approve all three; each starts executing and parks on the controller.
      for (const name of MOCK_FANOUT_TOOL_NAMES) {
        await approveToolInvocation(baseUrl, conversationId, ids[name]);
        await controller.waitForStart(name);
      }

      // Settle in REVERSE dispatch order — the first-created entry finishes
      // LAST. This is the exact production ordering that used to anchor the
      // continuation at the settling member (mid-batch), forking the chain
      // and dropping the stranded sibling's result from the continuation's
      // lineage.
      await resolveExecuting(conversationId, TOOL_C, 'ok');
      await expectPlannerRanOnce(conversationId);
      await resolveExecuting(conversationId, TOOL_B, 'ok');
      await expectPlannerRanOnce(conversationId);
      await resolveExecuting(conversationId, TOOL_A, 'ok');

      const entries = await waitFinalAnswer(conversationId);
      expect(plannerCount(entries)).toBe(2);
      expectLinearSpine(entries);

      // The continuation hangs off the batch TAIL (last-dispatched member),
      // never off whichever member happened to settle last.
      const tail = MOCK_FANOUT_TOOL_NAMES.map((n) => findTool(entries, n)!)
        .sort((a, b) => a.conversationIndex - b.conversationIndex)
        .at(-1)!;
      const continuation = entries.filter(
        (e) => e.type === 'thought-prepare' && e.title === PLANNER_TITLE,
      )[1];
      expect(continuation?.parentId).toBe(tail.id);

      // Every member's result sits on the continuation's lineage — walking up
      // from the continuation must pass through all three tool entries.
      const lineage = walkParentChain(entries, continuation!.id).map((e) => e.id);
      for (const name of MOCK_FANOUT_TOOL_NAMES) expect(lineage).toContain(ids[name]);
    }, 60_000);

    it('mixed batch: auto-run member still executing while approvals settle → linear spine', async () => {
      // TOOL_A auto-runs (allow) and is held executing; B and C need approval.
      const overrides = {
        tools: {
          [TOOL_A]: { policy: 'allow' },
          [TOOL_B]: { policy: 'ask' },
          [TOOL_C]: { policy: 'ask' },
        },
      };
      const conversationId = await startFanout(defaultAgentId, overrides);
      await controller.waitForStart(TOOL_A);
      const ids: Record<string, string> = {};
      for (const name of [TOOL_B, TOOL_C]) ids[name] = (await waitRequested(conversationId, name)).id;

      // Approvals settle while the auto-run member is still executing.
      await approveAndComplete(conversationId, TOOL_B, ids[TOOL_B]);
      await expectPlannerRanOnce(conversationId);
      await approveAndComplete(conversationId, TOOL_C, ids[TOOL_C]);
      await expectPlannerRanOnce(conversationId);
      await resolveExecuting(conversationId, TOOL_A, 'ok');

      const entries = await waitFinalAnswer(conversationId);
      expect(plannerCount(entries)).toBe(2);
      expectLinearSpine(entries);
    }, 60_000);
  });

  // --- scenario 6: the post-tool planner keeps the message's model ----------

  // Planner-model resolution follows last-user-message > agent > system. After a
  // tool call the continuation must still honor the model chosen on the message,
  // not silently fall back to the agent/system default. The seed's default agent
  // AND the system default both resolve to model `stub`, so an explicit
  // `stub-model` on the message is a distinct override: EVERY planner on the path
  // — the initial fan-out and the continuation after the tools settle — must run
  // under `stub-model`. (Regression guard: approve/deny used to resolve from the
  // agent id alone, so the continuation reverted to `stub`.)
  describe('continuation planner honors the last user message model', () => {
    const EXPLICIT = { providerId: 'stub', model: 'stub-model' };

    const plannerModels = (entries: ChatEntryRow[]): string[] =>
      entries
        .filter((e) => e.type === 'thought-prepare' && e.title === PLANNER_TITLE)
        .map((e) => e.llm?.model ?? '');

    it('every approved → continuation keeps the message model, not the agent default', async () => {
      const conversationId = await startFanout(defaultAgentId, toolOverrides('ask'), EXPLICIT);

      const ids: Record<string, string> = {};
      for (const name of MOCK_FANOUT_TOOL_NAMES) ids[name] = (await waitRequested(conversationId, name)).id;
      for (const name of MOCK_FANOUT_TOOL_NAMES) await approveAndComplete(conversationId, name, ids[name]);

      const entries = await waitFinalAnswer(conversationId);
      expect(plannerModels(entries)).toEqual(['stub-model', 'stub-model']);
    }, 60_000);

    it('one denied → continuation keeps the message model, not the agent default', async () => {
      const conversationId = await startFanout(defaultAgentId, toolOverrides('ask'), EXPLICIT);

      const ids: Record<string, string> = {};
      for (const name of MOCK_FANOUT_TOOL_NAMES) ids[name] = (await waitRequested(conversationId, name)).id;

      await denyToolInvocation(baseUrl, conversationId, ids[TOOL_A]);
      await waitToolState(conversationId, TOOL_A, 'denied');
      await approveAndComplete(conversationId, TOOL_B, ids[TOOL_B]);
      await approveAndComplete(conversationId, TOOL_C, ids[TOOL_C]);

      const entries = await waitFinalAnswer(conversationId);
      expect(plannerModels(entries)).toEqual(['stub-model', 'stub-model']);
    }, 60_000);
  });
});
