import type { AgentEntity } from '../agents/agent.entity.js';
import { resolveToolConfig } from './resolve-tool-config.js';

const agent = {
  id: 'a1',
  default_llm_configuration: {
    tools: {
      bash: { enabled: true, rules: { allowed: 'ask' }, guardrail: true },
    },
  },
} as AgentEntity;

describe('resolveToolConfig', () => {
  it('returns agent config when no override', () => {
    expect(resolveToolConfig(agent, undefined, 'bash')).toEqual({
      enabled: true,
      rules: { allowed: 'ask' },
      guardrail: true,
    });
  });

  it('shallow-merges override onto agent config', () => {
    expect(
      resolveToolConfig(agent, { bash: { enabled: false } }, 'bash'),
    ).toEqual({
      enabled: false,
      rules: { allowed: 'ask' },
      guardrail: true,
    });
  });

  it('merges rules objects', () => {
    expect(
      resolveToolConfig(agent, { bash: { rules: { allowed: 'always' } } }, 'bash'),
    ).toEqual({
      enabled: true,
      rules: { allowed: 'always' },
      guardrail: true,
    });
  });
});
