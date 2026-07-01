import type { AgentEntity } from '../agents/agent.entity.js';
import { resolveSeparateParamsResolution, resolveToolConfig } from './resolve-tool-config.js';

const agent = {
  id: 'a1',
  default_llm_configuration: {
    tools: {
      exec: { policy: 'ask', rules: { working_dir: '/tmp' }, guardrail: true },
    },
  },
} as unknown as AgentEntity;

function agentWith(overrides: {
  agentLevel?: boolean | null;
  toolLevel?: boolean;
}): AgentEntity {
  return {
    id: 'a1',
    default_llm_configuration: {
      ...(overrides.agentLevel !== undefined ? { separate_params_resolution: overrides.agentLevel } : {}),
      tools: {
        exec: {
          policy: 'ask',
          ...(overrides.toolLevel !== undefined ? { separate_params_resolution: overrides.toolLevel } : {}),
        },
      },
    },
  } as unknown as AgentEntity;
}

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

describe('resolveSeparateParamsResolution', () => {
  it('defaults to true when neither agent nor tool set a flag', () => {
    expect(resolveSeparateParamsResolution(agent, undefined, 'exec')).toBe(true);
  });

  it('honors the per-tool flag when the agent has no override', () => {
    expect(resolveSeparateParamsResolution(agentWith({ toolLevel: false }), undefined, 'exec')).toBe(false);
    expect(resolveSeparateParamsResolution(agentWith({ toolLevel: true }), undefined, 'exec')).toBe(true);
  });

  it('honors a conversation-level tool override when the agent has no override', () => {
    expect(
      resolveSeparateParamsResolution(agentWith({ toolLevel: true }), { exec: { separate_params_resolution: false } }, 'exec'),
    ).toBe(false);
  });

  it('agent-level true forces true even when the tool sets false', () => {
    expect(resolveSeparateParamsResolution(agentWith({ agentLevel: true, toolLevel: false }), undefined, 'exec')).toBe(
      true,
    );
  });

  it('agent-level false forces false even when the tool sets true', () => {
    expect(resolveSeparateParamsResolution(agentWith({ agentLevel: false, toolLevel: true }), undefined, 'exec')).toBe(
      false,
    );
  });

  it('agent-level false forces false even when a conversation override sets true', () => {
    expect(
      resolveSeparateParamsResolution(
        agentWith({ agentLevel: false }),
        { exec: { separate_params_resolution: true } },
        'exec',
      ),
    ).toBe(false);
  });

  it('agent-level null defers to the per-tool flag', () => {
    expect(resolveSeparateParamsResolution(agentWith({ agentLevel: null, toolLevel: false }), undefined, 'exec')).toBe(
      false,
    );
  });

  it('missing agent defers to true', () => {
    expect(resolveSeparateParamsResolution(null, undefined, 'exec')).toBe(true);
  });
});
