import { parsePlannerOutput } from '../plannerTextParsing.js';
import { buildPlannerSyntaxRegistry } from './index.js';

describe('planner syntax registry — precedence', () => {
  it('prefers JSON tool_requests (confidence 1) over everything', () => {
    const raw = JSON.stringify({
      assistant_output: 'Checking.',
      tool_requests: [{ tool_name: 'get_current_time', tool_request: 'now' }],
      followup: 'continue',
    });
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([{ toolName: 'get_current_time', toolRequest: 'now' }]);
    expect(parsed.followup).toBe('continue');
  });

  it('lets Gemma tool calls beat a JSON object without tool_requests', () => {
    const raw = '{"assistant_output":"On it."}<|tool_call>call:get_current_time{tool_request:<|"|>now<|"|>}<tool_call|>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([{ toolName: 'get_current_time', toolRequest: 'now' }]);
    expect(parsed.assistantOutput).toBe('On it.');
  });

  it('keeps a valid JSON-without-tools reply (does not report a parse failure)', () => {
    const onFail = jest.fn();
    const parsed = parsePlannerOutput('{"assistant_output":"All done.","followup":"finalize"}', onFail);
    expect(parsed.assistantOutput).toBe('All done.');
    expect(parsed.toolRequests).toEqual([]);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('reports a parse failure only when nothing structured matches (plaintext)', () => {
    const onFail = jest.fn();
    const parsed = parsePlannerOutput('just some prose, no structure', onFail);
    expect(parsed.toolRequests).toEqual([]);
    expect(parsed.assistantOutput).toBe('just some prose, no structure');
    expect(onFail).toHaveBeenCalledTimes(1);
  });
});

describe('planner syntax registry — XML dialect (extensibility)', () => {
  it('parses the name="..." attribute form', () => {
    const raw = '<assistant_output>On it.</assistant_output><tool_call name="get_current_time">now</tool_call>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([{ toolName: 'get_current_time', toolRequest: 'now' }]);
    expect(parsed.assistantOutput).toBe('On it.');
    expect(parsed.followup).toBe('continue');
  });

  it('parses nested <tool_name>/<tool_request> children and multiple calls', () => {
    const raw =
      'Let me look that up.' +
      '<tool_call><tool_name>search</tool_name><tool_request>cats</tool_request></tool_call>' +
      '<tool_call name="get_current_time">now</tool_call>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([
      { toolName: 'search', toolRequest: 'cats' },
      { toolName: 'get_current_time', toolRequest: 'now' },
    ]);
    expect(parsed.assistantOutput).toBe('Let me look that up.');
  });

  it('beats a JSON object that carries no tool_requests', () => {
    const raw = '{"assistant_output":"Searching."}<tool_call name="search">dogs</tool_call>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([{ toolName: 'search', toolRequest: 'dogs' }]);
  });
});

describe('planner syntax registry — streaming', () => {
  it('does not commit to plaintext while a JSON tool-call reply is still streaming', () => {
    const selector = buildPlannerSyntaxRegistry().createSelector();
    // Partial JSON: object not closed yet → JSON is Incomplete, so the selector
    // must NOT lock onto the always-matching plaintext fallback.
    expect(selector.observe('{"assistant_output":"hi","tool_requests":[{"tool_name":"x",')).toBeNull();
    expect(selector.isLocked).toBe(false);

    // Once the JSON closes with tool requests, it locks onto the JSON syntax.
    const locked = selector.observe('{"assistant_output":"hi","tool_requests":[{"tool_name":"x","tool_request":"y"}]}');
    expect(locked?.name).toBe('json');
  });

  it('waits on an unclosed <tool_call> then locks the XML dialect', () => {
    const selector = buildPlannerSyntaxRegistry().createSelector();
    expect(selector.observe('thinking <tool_call name="search">do')).toBeNull();
    expect(selector.observe('thinking <tool_call name="search">dogs</tool_call>')?.name).toBe('tool-call-tags');
  });
});
