import { describe, expect, it } from '@jest/globals';
import type { ChatEntry, ToolState } from '../contracts/chatEntry.js';
import { resolveLlmSwitchState } from './llm-switch.js';

let nextIndex = 0;
function base(): { id: string; conversationIndex: number; createdAt: string; parentId: string | null; isSide: boolean } {
  nextIndex++;
  return {
    id: `e${nextIndex}`,
    conversationIndex: nextIndex,
    createdAt: new Date(0).toISOString(),
    parentId: null,
    isSide: false,
  };
}

function userMsg(): ChatEntry {
  return { ...base(), type: 'user-message', text: 'hi', agentId: 'a1' } as ChatEntry;
}

function plannerThought(isSide = false): ChatEntry {
  return { ...base(), type: 'thought', thoughtType: 'planner', isSide } as unknown as ChatEntry;
}

function switchCall(params: Record<string, unknown>, state: ToolState = 'done'): ChatEntry {
  return { ...base(), type: 'tool-invocation', toolId: 'switch_llm', state, parameters: params } as ChatEntry;
}

const SWITCH = { provider_id: 'openrouter', model_name: 'big-model' };
const ACTIVE = { kind: 'active', llm: { providerId: 'openrouter', model: 'big-model' } };

describe('resolveLlmSwitchState', () => {
  it('reports none when the run has no switch', () => {
    expect(resolveLlmSwitchState([userMsg(), plannerThought()])).toEqual({ kind: 'none' });
  });

  it('applies an accepted this_run switch for the rest of the run', () => {
    const entries = [userMsg(), plannerThought(), switchCall(SWITCH), plannerThought(), plannerThought()];
    expect(resolveLlmSwitchState(entries)).toEqual(ACTIVE);
  });

  it('expires at the run boundary — a new user message ends this_run', () => {
    const entries = [userMsg(), switchCall(SWITCH), userMsg()];
    expect(resolveLlmSwitchState(entries)).toEqual({ kind: 'none' });
  });

  it('ignores denied/errored/pending switches', () => {
    for (const state of ['denied', 'error', 'running', 'requested'] as const) {
      expect(resolveLlmSwitchState([userMsg(), switchCall(SWITCH, state)])).toEqual({ kind: 'none' });
    }
  });

  it('n_turns: applies until that many planner rounds ran on it, then expires', () => {
    const entries = [userMsg(), plannerThought(), switchCall({ ...SWITCH, scope: 'n_turns', turns: 2 })];
    // 0 rounds since the switch → active.
    expect(resolveLlmSwitchState(entries)).toEqual(ACTIVE);
    entries.push(plannerThought());
    expect(resolveLlmSwitchState(entries)).toEqual(ACTIVE);
    entries.push(plannerThought());
    expect(resolveLlmSwitchState(entries)).toEqual({ kind: 'expired' });
  });

  it('n_turns ignores side-lane and pre-switch planner thoughts', () => {
    const entries = [
      userMsg(),
      plannerThought(), // pre-switch — not counted
      switchCall({ ...SWITCH, scope: 'n_turns', turns: 1 }),
      plannerThought(true), // side lane — not counted
    ];
    expect(resolveLlmSwitchState(entries)).toEqual(ACTIVE);
  });

  it('the latest accepted switch supersedes earlier ones', () => {
    const entries = [
      userMsg(),
      switchCall(SWITCH),
      switchCall({ provider_id: 'lmstudio', model_name: 'small-model' }),
    ];
    expect(resolveLlmSwitchState(entries)).toEqual({
      kind: 'active',
      llm: { providerId: 'lmstudio', model: 'small-model' },
    });
  });

  it('an expired latest switch reverts — it does not resurrect an older one', () => {
    const entries = [
      userMsg(),
      switchCall(SWITCH),
      switchCall({ provider_id: 'lmstudio', model_name: 'small-model', scope: 'n_turns', turns: 1 }),
      plannerThought(),
    ];
    expect(resolveLlmSwitchState(entries)).toEqual({ kind: 'expired' });
  });
});
