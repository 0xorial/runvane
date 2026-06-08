import { parseApiToolParams } from './params.js';

describe('parseApiToolParams', () => {
  it('accepts list_tools operation', () => {
    expect(parseApiToolParams({ operation: 'list_tools' }).operation).toBe('list_tools');
  });

  it('accepts describe_tool with tool_name', () => {
    expect(parseApiToolParams({ operation: 'describe_tool', tool_name: 'filesystem' }).tool_name).toBe(
      'filesystem',
    );
  });

  it('accepts get_agent with agent_id', () => {
    expect(parseApiToolParams({ operation: 'get_agent', agent_id: 'agent-1' }).agent_id).toBe('agent-1');
  });

  it('accepts list_agents and list_model_presets', () => {
    expect(parseApiToolParams({ operation: 'list_agents' }).operation).toBe('list_agents');
    expect(parseApiToolParams({ operation: 'list_model_presets' }).operation).toBe('list_model_presets');
  });

  it('accepts get_model_preset with preset_id', () => {
    expect(parseApiToolParams({ operation: 'get_model_preset', preset_id: 3 }).preset_id).toBe(3);
  });
});
