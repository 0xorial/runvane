import type { LlmRequest } from '../types.js';
import {
  abortableDelay,
  isSteerProbeMessage,
  parseStubDelayMs,
  pickStubReply,
  PROBE_TIME_USER_MESSAGE,
  steerProbeReply,
  stubProbeTimePlannerFirstRound,
} from './stubLlm.helpers.js';

describe('stubLlm.helpers', () => {
  it('parseStubDelayMs reads embedded delay marker', () => {
    expect(parseStubDelayMs('hello __stub_delay:250__ world')).toBe(250);
    expect(parseStubDelayMs('no marker')).toBeNull();
  });

  it('abortableDelay rejects when signal aborts', async () => {
    const controller = new AbortController();
    const pending = abortableDelay(500, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('steer probe reply is deterministic', () => {
    expect(isSteerProbeMessage('please __steer_probe__ now')).toBe(true);
    expect(steerProbeReply()).toContain('Steered response.');
  });

  it('probe planner first round requests get_current_time', () => {
    const request: LlmRequest = {
      messages: [
        {
          role: 'system',
          parts: [
            {
              kind: 'text',
              text: 'Tools: get_current_time\n\nReply with one JSON object, no markedown, no prose:',
            },
          ],
        },
        { role: 'user', parts: [{ kind: 'text', text: PROBE_TIME_USER_MESSAGE }] },
      ],
    };
    const reply = pickStubReply(request);
    expect(reply).toBe(stubProbeTimePlannerFirstRound());
    expect(JSON.parse(reply).tool_requests).toEqual([
      { tool_name: 'get_current_time', tool_request: 'current server time' },
    ]);
  });

  it('probe planner second round finalizes after tool result', () => {
    const request: LlmRequest = {
      messages: [
        {
          role: 'system',
          parts: [
            {
              kind: 'text',
              text: 'Tools: get_current_time\n\nReply with one JSON object, no markedown, no prose:',
            },
          ],
        },
        { role: 'user', parts: [{ kind: 'text', text: PROBE_TIME_USER_MESSAGE }] },
        {
          role: 'assistant',
          parts: [{ kind: 'tool_call', callId: 'call-1', toolName: 'get_current_time', args: {} }],
        },
        {
          role: 'tool',
          parts: [{ kind: 'tool_result', callId: 'call-1', ok: true, payload: '{"nowIso":"2026-01-01T12:00:00.000Z"}' }],
        },
      ],
    };
    const reply = pickStubReply(request);
    const parsed = JSON.parse(reply);
    expect(parsed.tool_requests).toEqual([]);
    expect(parsed.followup).toBe('finalize');
    expect(parsed.assistant_output).toContain('12:00 UTC');
  });

  it('tool params request returns empty JSON object', () => {
    const request: LlmRequest = {
      messages: [
        {
          role: 'system',
          parts: [{ kind: 'text', text: 'Produce JSON args for tool "get_current_time".' }],
        },
        { role: 'user', parts: [{ kind: 'text', text: 'current server time' }] },
      ],
    };
    expect(pickStubReply(request)).toBe('{}');
  });
});
