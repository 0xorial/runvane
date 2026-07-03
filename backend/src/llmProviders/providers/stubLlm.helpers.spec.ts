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

  it('attachment follow-up planner requests ask_attachment', () => {
    const request: LlmRequest = {
      messages: [
        {
          role: 'system',
          parts: [
            {
              kind: 'text',
              // Mirror the real plannerPrompt.ts tools header (one tool per line
              // under a `Tools (…):` header) so this fixture actually exercises
              // the same matcher path the integration/e2e specs hit.
              text:
                "Tools (a separate agent fills each call's JSON args from your natural-language request):\n" +
                '- get_current_time — Returns current server time.\n' +
                '- ask_attachment — Ask a focused question about one attachment. Use this when an <attachment_summary> block does not contain the detail you need.\n\n' +
                'Reply with one JSON object, no markedown, no prose:',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              kind: 'text',
              text: 'see notes\n<attachment_summary id="att-1" filename="notes.txt" mime="text/plain" size_bytes="12">\nsummary\n</attachment_summary>',
            },
          ],
        },
        { role: 'assistant', parts: [{ kind: 'text', text: 'First reply.' }] },
        { role: 'user', parts: [{ kind: 'text', text: 'What exact palette and mood does the full file suggest?' }] },
      ],
    };
    const reply = pickStubReply(request);
    const parsed = JSON.parse(reply);
    expect(parsed.tool_requests).toEqual([
      { tool_name: 'ask_attachment', tool_request: 'What exact palette and mood does the full attachment convey?' },
    ]);
    expect(parsed.followup).toBe('continue');
  });

  it('ask_attachment tool params include attachment_id from context note', () => {
    const request: LlmRequest = {
      messages: [
        {
          role: 'system',
          parts: [{ kind: 'text', text: 'Produce JSON args for tool "ask_attachment".' }],
        },
        {
          role: 'user',
          parts: [
            {
              kind: 'text',
              text:
                'Attachments in this conversation — set attachment_id to one of:\n' +
                '- 11111111-1111-4111-8111-111111111111 (notes.txt, summary)\n\n' +
                'Planner request: palette and mood from the full file',
            },
          ],
        },
      ],
    };
    expect(JSON.parse(pickStubReply(request))).toEqual({
      attachment_id: '11111111-1111-4111-8111-111111111111',
      question: 'palette and mood from the full file',
    });
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

  it('graph extraction reply reads [[entity]] and [[A]] --rel--> [[B]] annotations per chunk', () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', parts: [{ kind: 'text', text: 'You extract a knowledge graph from a document.' }] },
        {
          role: 'user',
          parts: [
            {
              kind: 'text',
              text:
                'Document: a.md\n\n' +
                '[chunk 0]\nThe [[Alpha Service]] --publishes to--> [[Beta Queue]] on every request.\n\n' +
                '[chunk 1]\nMore about the [[Beta Queue]] internals.',
            },
          ],
        },
      ],
    };
    const reply = JSON.parse(pickStubReply(request)) as {
      entities: Array<{ name: string; chunks: number[] }>;
      relations: Array<{ source: string; relation: string; target: string }>;
    };
    expect(reply.entities).toEqual([
      { name: 'Alpha Service', chunks: [0] },
      { name: 'Beta Queue', chunks: [0, 1] },
    ]);
    expect(reply.relations).toEqual([
      { source: 'Alpha Service', relation: 'publishes to', target: 'Beta Queue' },
    ]);
  });
});
