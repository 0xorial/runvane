import { parsePlannerOutput } from '../plannerTextParsing.js';
import { buildPlannerSyntaxRegistry } from './index.js';

describe('Hermes / Qwen <tool_call>{json}</tool_call>', () => {
  it('parses a JSON body inside the tags', () => {
    const parsed = parsePlannerOutput('<tool_call>{"name": "search", "arguments": {"q": "cats"}}</tool_call>');
    expect(parsed.toolRequests).toEqual([{ toolName: 'search', toolRequest: '{"q":"cats"}' }]);
    expect(parsed.followup).toBe('continue');
  });

  it('keeps prose before the block and parses multiple calls', () => {
    const raw =
      'Looking those up.' +
      '<tool_call>{"name": "search", "arguments": {"q": "cats"}}</tool_call>' +
      '<tool_call name="get_time">now</tool_call>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([
      { toolName: 'search', toolRequest: '{"q":"cats"}' },
      { toolName: 'get_time', toolRequest: 'now' },
    ]);
    expect(parsed.assistantOutput).toBe('Looking those up.');
  });
});

describe('bare function-call JSON', () => {
  it('parses a single {name, arguments} object', () => {
    const parsed = parsePlannerOutput('{"name": "get_weather", "arguments": {"city": "Tokyo"}}');
    expect(parsed.toolRequests).toEqual([{ toolName: 'get_weather', toolRequest: '{"city":"Tokyo"}' }]);
  });

  it('parses an array, honoring both `arguments` and `parameters`', () => {
    const parsed = parsePlannerOutput('[{"name": "a", "arguments": {}}, {"name": "b", "parameters": {"x": 1}}]');
    expect(parsed.toolRequests).toEqual([
      { toolName: 'a', toolRequest: '{}' },
      { toolName: 'b', toolRequest: '{"x":1}' },
    ]);
  });

  it('parses the OpenAI tool_calls wrapper with stringified arguments', () => {
    const raw = '{"tool_calls": [{"type": "function", "function": {"name": "a", "arguments": "{\\"x\\":1}"}}]}';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([{ toolName: 'a', toolRequest: '{"x":1}' }]);
  });

  it('does not hijack a planner-native tool_requests reply', () => {
    const parsed = parsePlannerOutput(
      '{"assistant_output": "hi", "tool_requests": [{"tool_name": "x", "tool_request": "y"}]}',
    );
    expect(parsed.toolRequests).toEqual([{ toolName: 'x', toolRequest: 'y' }]);
  });
});

describe('Mistral [TOOL_CALLS]', () => {
  it('parses calls after the marker and keeps preceding prose', () => {
    const raw = 'Sure.\n[TOOL_CALLS] [{"name": "get_weather", "arguments": {"city": "Tokyo"}}]';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.assistantOutput).toBe('Sure.');
    expect(parsed.toolRequests).toEqual([{ toolName: 'get_weather', toolRequest: '{"city":"Tokyo"}' }]);
  });
});

describe('Llama <|python_tag|>', () => {
  it('parses a call between the python tag and eom marker', () => {
    const raw = 'On it.<|python_tag|>{"name": "get_weather", "parameters": {"city": "Tokyo"}}<|eom_id|>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.assistantOutput).toBe('On it.');
    expect(parsed.toolRequests).toEqual([{ toolName: 'get_weather', toolRequest: '{"city":"Tokyo"}' }]);
  });
});

describe('new dialects — streaming locks', () => {
  it('waits on a partial Mistral payload then locks', () => {
    const selector = buildPlannerSyntaxRegistry().createSelector();
    expect(selector.observe('[TOOL_CALLS] [{"name": "x",')).toBeNull();
    expect(selector.observe('[TOOL_CALLS] [{"name": "x", "arguments": {}}]')?.name).toBe('mistral-tool-calls');
  });

  it('waits on a partial Hermes JSON body then locks', () => {
    const selector = buildPlannerSyntaxRegistry().createSelector();
    expect(selector.observe('<tool_call>{"name": "search"')).toBeNull();
    expect(selector.observe('<tool_call>{"name": "search", "arguments": {}}</tool_call>')?.name).toBe(
      'tool-call-tags',
    );
  });
});
