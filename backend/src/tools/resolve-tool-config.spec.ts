import type { AgentEntity } from '../agents/agent.entity.js';
import { resolveToolConfig } from './resolve-tool-config.js';

const agent = {
  id: 'a1',
  default_llm_configuration: {
    tools: {
      exec: { policy: 'ask', rules: { working_dir: '/tmp' }, guardrail: true },
    },
  },
} as unknown as AgentEntity;

describe('resolveToolConfig', () => {
  it('returns agent config when no override', () => {
    expect(resolveToolConfig(agent, undefined, 'exec')).toEqual({
      policy: 'ask',
      rules: { working_dir: '/tmp' },
      guardrail: true,
    });
  });

  it('shallow-merges override onto agent config', () => {
    expect(
      resolveToolConfig(agent, { exec: { policy: 'off' } }, 'exec'),
    ).toEqual({
      policy: 'off',
      rules: { working_dir: '/tmp' },
      guardrail: true,
    });
  });

  it('merges rules objects', () => {
    expect(
      resolveToolConfig(agent, { exec: { rules: { working_dir: '/other' } } }, 'exec'),
    ).toEqual({
      policy: 'ask',
      rules: { working_dir: '/other' },
      guardrail: true,
    });
  });
});
