import {
  gemmaArgsToToolRequest,
  parseGemma4ToolCallArgs,
  parseGemma4ToolCalls,
} from './gemma4ToolCallParsing.js';
import { parsePlannerCompletion, parsePlannerOutput } from './plannerTextParsing.js';
import type { LlmCompletion } from '../../llmProviders/types.js';

describe('parsePlannerCompletion — native tool_calls', () => {
  it('surfaces native OpenAI tool_calls as tool requests (empty text content)', () => {
    const completion: LlmCompletion = {
      parts: [{ kind: 'tool_call', callId: 'c1', toolName: 'bash', args: { command: 'ls -la' } }],
      finishReason: 'tool_calls',
    };
    const parsed = parsePlannerCompletion(completion);
    expect(parsed.toolRequests).toEqual([{ toolName: 'bash', toolRequest: '{"command":"ls -la"}' }]);
    expect(parsed.followup).toBe('continue');
  });

  it('merges native tool_calls with parsed text and keeps the prose', () => {
    const completion: LlmCompletion = {
      parts: [
        { kind: 'text', text: '{"assistant_output":"On it."}' },
        { kind: 'tool_call', callId: 'c1', toolName: 'search', args: { q: 'cats' } },
      ],
      finishReason: 'tool_calls',
    };
    const parsed = parsePlannerCompletion(completion);
    expect(parsed.assistantOutput).toBe('On it.');
    expect(parsed.toolRequests).toEqual([{ toolName: 'search', toolRequest: '{"q":"cats"}' }]);
  });

  it('drops text-channel tool requests when native tool_calls are present (same intent twice)', () => {
    const completion: LlmCompletion = {
      parts: [
        {
          kind: 'text',
          text: '{"assistant_output":"Searching.","tool_requests":[{"tool_name":"search","tool_request":"find cats please"}]}',
        },
        { kind: 'tool_call', callId: 'c1', toolName: 'search', args: { q: 'cats' } },
      ],
      finishReason: 'tool_calls',
    };
    const parsed = parsePlannerCompletion(completion);
    expect(parsed.assistantOutput).toBe('Searching.');
    // One member, from the structured channel — not two for one logical call.
    expect(parsed.toolRequests).toEqual([{ toolName: 'search', toolRequest: '{"q":"cats"}' }]);
  });

  it('falls back to text parsing when there are no native tool_calls', () => {
    const completion: LlmCompletion = {
      parts: [{ kind: 'text', text: '{"tool_requests":[{"tool_name":"x","tool_request":"y"}]}' }],
      finishReason: 'tool_calls',
    };
    expect(parsePlannerCompletion(completion).toolRequests).toEqual([{ toolName: 'x', toolRequest: 'y' }]);
  });
});

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
