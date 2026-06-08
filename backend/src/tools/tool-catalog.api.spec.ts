import type { BaseTool } from './base-tool.js';
import { describeToolCatalog, listToolCatalog, toToolCatalogRow } from './tool-catalog.api.js';
import { ToolRegistry } from './tool-registry.js';

function stubTool(name: string): BaseTool {
  return {
    getName: () => name,
    getHumanDescription: () => `${name} human`,
    getAiDescription: () => `${name} ai`,
    getParamsSchema: () => ({ type: 'object' }),
    getRulesSchema: () => ({ type: 'object' }),
    getDefaultRules: () => ({ allowed: 'ask' }),
    parseParams: (raw) => raw,
    parseRules: (raw) => raw,
    evaluatePermission: () => [{ ruleName: 'allowed', permission: 'ask_user', detail: '' }],
    runTool: async () => ({}),
  };
}

describe('tool-catalog.api', () => {
  it('maps a tool to catalog row fields', () => {
    const row = toToolCatalogRow(stubTool('filesystem'));
    expect(row).toEqual({
      name: 'filesystem',
      description: 'filesystem human',
      ai_description: 'filesystem ai',
      params_schema: { type: 'object' },
      rules_schema: { type: 'object' },
      default_rules: { allowed: 'ask' },
    });
  });

  it('lists and describes tools from registry', () => {
    const registry = new ToolRegistry([stubTool('api'), stubTool('conversations')]);
    const names = listToolCatalog(registry).map((row) => row.name);
    expect(names).toEqual(['api', 'conversations']);
    expect(describeToolCatalog(registry, 'api').name).toBe('api');
    expect(() => describeToolCatalog(registry, 'missing')).toThrow(/unknown tool missing/);
  });
});
