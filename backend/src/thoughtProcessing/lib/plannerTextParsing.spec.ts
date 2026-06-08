import {
  gemmaArgsToToolRequest,
  parseGemma4ToolCallArgs,
  parseGemma4ToolCalls,
} from './gemma4ToolCallParsing.js';
import { parsePlannerOutput } from './plannerTextParsing.js';

describe('gemma4ToolCallParsing', () => {
  it('parses curl call with quoted url', () => {
    const raw =
      '<|tool_call>call:curl{url:<|"|>https://www.google.com/<|"|>}<tool_call|>';
    expect(parseGemma4ToolCalls(raw)).toEqual([
      { toolName: 'curl', args: { url: 'https://www.google.com/' } },
    ]);
    expect(gemmaArgsToToolRequest({ url: 'https://www.google.com/' })).toBe('https://www.google.com/');
  });

  it('parses get_current_time with tool_request field', () => {
    const raw =
      '<|tool_call>call:get_current_time{source:<|"|>planner_tool_request<|"|>,tool_request:<|"|>Get the current date and time in full detail (including day name)<|"|>}<tool_call|>';
    const calls = parseGemma4ToolCalls(raw);
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('get_current_time');
    expect(gemmaArgsToToolRequest(calls[0].args)).toBe(
      'Get the current date and time in full detail (including day name)',
    );
  });

  it('parses bare numeric and boolean args', () => {
    expect(parseGemma4ToolCallArgs('count:3,enabled:true,label:<|"|>hi<|"|>')).toEqual({
      count: '3',
      enabled: 'true',
      label: 'hi',
    });
  });
});

describe('parsePlannerOutput', () => {
  it('prefers JSON tool_requests when present', () => {
    const parsed = parsePlannerOutput(
      JSON.stringify({
        assistant_output: 'Checking time.',
        tool_requests: [{ tool_name: 'get_current_time', tool_request: 'now' }],
        followup: 'continue',
      }),
    );
    expect(parsed.toolRequests).toEqual([{ toolName: 'get_current_time', toolRequest: 'now' }]);
    expect(parsed.followup).toBe('continue');
  });

  it('falls back to gemma4 tool_call blocks when JSON is missing', () => {
    const raw =
      '<|tool_call>call:curl{url:<|"|>https://www.google.com/<|"|>}<tool_call|>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([
      { toolName: 'curl', toolRequest: 'https://www.google.com/' },
    ]);
    expect(parsed.followup).toBe('continue');
    expect(parsed.assistantOutput).toBe('');
  });

  it('extracts gemma tool calls from JSON without tool_requests', () => {
    const raw =
      '{"assistant_output":"On it."}<|tool_call>call:get_current_time{tool_request:<|"|>current time<|"|>}<tool_call|>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.toolRequests).toEqual([{ toolName: 'get_current_time', toolRequest: 'current time' }]);
    expect(parsed.assistantOutput).toBe('On it.');
  });

  it('keeps prose assistant output before gemma tool blocks', () => {
    const raw =
      'Let me check.\n<|tool_call>call:get_current_time{tool_request:<|"|>now<|"|>}<tool_call|>';
    const parsed = parsePlannerOutput(raw);
    expect(parsed.assistantOutput).toBe('Let me check.');
    expect(parsed.toolRequests).toHaveLength(1);
  });
});
