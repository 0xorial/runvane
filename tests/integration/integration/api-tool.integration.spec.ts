import { ApiTool } from '../../../backend/src/tools/builtins/api/tool.js';
import { getDefaultAgentId } from '../support/http';
import { retainSharedTestApp } from '../support/shared-app';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('api tool (integration)', () => {
  let baseUrl: string;
  let apiTool: ApiTool;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
    apiTool = testApp.app.get(ApiTool);
  }, 30_000);

  const context = {
    conversationId: 'conv-test',
    agentId: null,
    entries: [],
    signal: AbortSignal.timeout(10_000),
  };

  it('lists tools and agents through backend services', async () => {
    const tools = await apiTool.runTool({ operation: 'list_tools' }, context);
    const toolNames = (tools as { tools: Array<{ name: string }> }).tools.map((row) => row.name);
    expect(toolNames).toContain('api');
    expect(toolNames).toContain('conversations');

    const described = await apiTool.runTool({ operation: 'describe_tool', tool_name: 'conversations' }, context);
    const tool = (described as { tool: { name: string; params_schema: unknown } }).tool;
    expect(tool.name).toBe('conversations');
    expect(tool.params_schema).toBeTruthy();

    const agents = await apiTool.runTool({ operation: 'list_agents' }, context);
    const agentRows = (agents as { agents: Array<{ id: string; name: string }> }).agents;
    expect(agentRows.length).toBeGreaterThan(0);

    const agentId = await getDefaultAgentId(baseUrl);
    const agent = await apiTool.runTool({ operation: 'get_agent', agent_id: agentId }, context);
    expect((agent as { agent: { id: string } }).agent.id).toBe(agentId);

    const tasks = await apiTool.runTool({ operation: 'list_tasks' }, context);
    expect(Array.isArray((tasks as { tasks: unknown[] }).tasks)).toBe(true);
  });

  it('lists model presets and gets one when any exist', async () => {
    const listed = await apiTool.runTool({ operation: 'list_model_presets' }, context);
    const presets = (listed as { presets: Array<{ id: number; name: string }> }).presets;
    expect(Array.isArray(presets)).toBe(true);
    if (presets.length === 0) return;

    const fetched = await apiTool.runTool({ operation: 'get_model_preset', preset_id: presets[0].id }, context);
    expect((fetched as { preset: { id: number } }).preset.id).toBe(presets[0].id);
  });

  it('rejects missing ids and unknown resources', async () => {
    await expect(apiTool.runTool({ operation: 'describe_tool' }, context)).rejects.toThrow(/requires tool_name/);
    await expect(apiTool.runTool({ operation: 'get_agent' }, context)).rejects.toThrow(/requires agent_id/);
    await expect(apiTool.runTool({ operation: 'get_model_preset' }, context)).rejects.toThrow(/requires preset_id/);
    await expect(
      apiTool.runTool({ operation: 'describe_tool', tool_name: 'not-a-real-tool' }, context),
    ).rejects.toThrow(/unknown tool/);
    await expect(
      apiTool.runTool({ operation: 'get_agent', agent_id: 'missing-agent-id' }, context),
    ).rejects.toThrow(/agent not found/);
    await expect(apiTool.runTool({ operation: 'get_model_preset', preset_id: 9_999_999 }, context)).rejects.toThrow(
      /model preset not found/,
    );
  });
});
