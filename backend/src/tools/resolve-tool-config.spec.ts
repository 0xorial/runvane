import type { AgentEntity } from '../agents/agent.entity.js';
import { resolveToolConfig } from './resolve-tool-config.js';

const agent = {
  id: 'a1',
  default_llm_configuration: {
    tools: {
      bash: { policy: 'ask', rules: { working_dir: '/tmp' }, guardrail: true },
    },
  },
} as unknown as AgentEntity;

describe('resolveToolConfig', () => {
  it('returns agent config when no override', () => {
    expect(resolveToolConfig(agent, undefined, 'bash')).toEqual({
      policy: 'ask',
      rules: { working_dir: '/tmp' },
      guardrail: true,
    });
  });

  it('shallow-merges override onto agent config', () => {
    expect(
      resolveToolConfig(agent, { bash: { policy: 'off' } }, 'bash'),
    ).toEqual({
      policy: 'off',
      rules: { working_dir: '/tmp' },
      guardrail: true,
    });
  });

  it('merges rules objects', () => {
    expect(
      resolveToolConfig(agent, { bash: { rules: { working_dir: '/other' } } }, 'bash'),
    ).toEqual({
      policy: 'ask',
      rules: { working_dir: '/other' },
      guardrail: true,
    });
  });
});
