import { describe, expect, it } from '@jest/globals';
import type { ToolRunContext } from '../../base-tool.js';
import { RunSubagentTool } from './tool.js';

// Guard-path unit tests: the depth bound and the other-agent gate must refuse
// BEFORE any conversation is created. The full happy path (child conversation,
// wait, answer) is covered end-to-end in tests/e2e/27-run-subagent.spec.ts.

function makeTool(opts: { depth: number }): { tool: RunSubagentTool; created: string[] } {
  const created: string[] = [];
  const bridge = { get: () => ({ processMessage: async () => undefined, isProcessing: () => false, cancelProcessing: () => 0 }) };
  const conversations = {
    getSubagentLink: async () => ({ parentConversationId: null, depth: opts.depth }),
    getToolSandboxId: async () => null,
    create: async () => {
      created.push('child');
      return { id: 'child-1' };
    },
    setSubagentLink: async () => undefined,
  };
  const chatEntries = { listChatEntries: async () => [] };
  const agents = { get: async (id: string) => (id === 'known-agent' ? { id, name: 'Known' } : null) };
  const tool = new RunSubagentTool(
    bridge as never,
    conversations as never,
    chatEntries as never,
    agents as never,
  );
  return { tool, created };
}

function ctx(overrides: Partial<ToolRunContext> = {}): ToolRunContext {
  return {
    conversationId: 'parent-1',
    agentId: 'known-agent',
    entries: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('run_subagent guards', () => {
  it('refuses when the caller is already at max_depth, before creating anything', async () => {
    const { tool, created } = makeTool({ depth: 1 });
    await expect(tool.runTool({ prompt: 'do it' }, ctx())).rejects.toThrow(/max_depth 1 reached/);
    expect(created).toHaveLength(0);
  });

  it('refuses a different agent unless allow_other_agents is set', async () => {
    const { tool, created } = makeTool({ depth: 0 });
    await expect(tool.runTool({ prompt: 'do it', agent_id: 'other-agent' }, ctx())).rejects.toThrow(
      /allow_other_agents/,
    );
    expect(created).toHaveLength(0);
  });

  it('refuses an unknown agent', async () => {
    const { tool, created } = makeTool({ depth: 0 });
    await expect(
      tool.runTool({ prompt: 'do it', agent_id: 'ghost' }, ctx({ toolRules: { allow_other_agents: true } })),
    ).rejects.toThrow(/unknown agent 'ghost'/);
    expect(created).toHaveLength(0);
  });
});
