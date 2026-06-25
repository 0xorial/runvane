import { parsePlannerOutput } from '../plannerTextParsing.js';
import { buildPlannerSyntaxRegistry } from './index.js';

describe('Cohere Command-R (Action: json)', () => {
  it('parses the fenced Action JSON and keeps preceding prose', () => {
    const raw =
      'I will search.\nAction: ```json\n[{"tool_name": "web_search", "parameters": {"query": "penguins"}}]\n```';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.assistantOutput).toBe('I will search.');
    expect(parsed.toolRequests).toEqual([{ toolName: 'web_search', toolRequest: '{"query":"penguins"}' }]);
    expect(parsed.followup).toBe('continue');
  });

  it('does not fire on the bare word "Action:" in prose', () => {
    const onFail = jest.fn();
    const parsed = parsePlannerOutput('Action: I will think about it.', onFail);
    expect(parsed.toolRequests).toEqual([]);
    expect(onFail).toHaveBeenCalledTimes(1); // fell through to plaintext
  });

  it('waits on a partial Action payload then locks', () => {
    const selector = buildPlannerSyntaxRegistry().createSelector();
    expect(selector.observe('Action: ```json\n[{"tool_name": "x",')).toBeNull();
    expect(selector.observe('Action: ```json\n[{"tool_name": "x", "parameters": {}}]\n```')?.name).toBe(
      'cohere-command-r',
    );
  });
});

describe('Anthropic <function_calls><invoke>', () => {
  it('parses invoke blocks with parameters and keeps prose', () => {
    const raw =
      'Sure.<function_calls><invoke name="get_weather">' +
      '<parameter name="location">Tokyo</parameter><parameter name="unit">c</parameter>' +
      '</invoke></function_calls>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.assistantOutput).toBe('Sure.');
    expect(parsed.toolRequests).toEqual([
      { toolName: 'get_weather', toolRequest: '{"location":"Tokyo","unit":"c"}' },
    ]);
  });

  it('parses multiple invokes', () => {
    const raw =
      '<function_calls><invoke name="a"><parameter name="x">1</parameter></invoke>' +
      '<invoke name="b"></invoke></function_calls>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([
      { toolName: 'a', toolRequest: '{"x":"1"}' },
      { toolName: 'b', toolRequest: '' },
    ]);
  });

  it('waits on an unclosed invoke then locks', () => {
    const selector = buildPlannerSyntaxRegistry().createSelector();
    expect(selector.observe('<function_calls><invoke name="a"><parameter name="x">1')).toBeNull();
    expect(
      selector.observe('<function_calls><invoke name="a"><parameter name="x">1</parameter></invoke></function_calls>')
        ?.name,
    ).toBe('anthropic-invoke');
  });
});
