import type { LlmRequest } from '../types.js';
import { textMessage } from '../types.js';
import { STUB_DEMO_MODELS, STUB_E2E_MODELS } from './stubLlm.models.js';
import { StubLlmProvider } from './stubLlm.js';

describe('StubLlmProvider', () => {
  const emptyRequest: LlmRequest = { messages: [] };

  it('listModels returns e2e default or configured demo models', async () => {
    const e2e = new StubLlmProvider();
    expect(await e2e.listModels({})).toEqual([...STUB_E2E_MODELS]);
    const demo = new StubLlmProvider({ models: STUB_DEMO_MODELS });
    expect(await demo.listModels({})).toEqual([...STUB_DEMO_MODELS]);
  });

  it('setNextResponse overrides the next completion', async () => {
    const stub = new StubLlmProvider();
    stub.setNextResponse('queued-one');
    const deltas: string[] = [];
    const first = await stub.streamCompletion({}, 'stub-model', emptyRequest, (ev) => {
      if (ev.type === 'text_delta') deltas.push(ev.delta);
    });
    expect(first.parts[0]).toEqual({ kind: 'text', text: 'queued-one' });
    expect(stub.pendingCount()).toBe(0);

    const second = await stub.streamCompletion({}, 'stub-model', emptyRequest, () => {});
    expect(second.parts[0]?.kind === 'text' && second.parts[0].text).not.toBe('queued-one');
  });

  it('setNextResponses drains in order', async () => {
    const stub = new StubLlmProvider();
    stub.setNextResponses('a', 'b');
    const read = async () => {
      const parts: string[] = [];
      await stub.streamCompletion({}, 'm', emptyRequest, (ev) => {
        if (ev.type === 'text_delta') parts.push(ev.delta);
      });
      return parts.join('');
    };
    expect(await read()).toBe('a');
    expect(await read()).toBe('b');
  });

  it('reset clears the queue', async () => {
    const stub = new StubLlmProvider();
    stub.setNextResponse('drop-me');
    stub.reset();
    expect(stub.pendingCount()).toBe(0);
  });

  it('configure queues per model with per-response streamMs', async () => {
    const stub = new StubLlmProvider({ streamDelayMs: 99 });
    stub.configure([
      { model: 'gpt-4o', responses: [{ text: 'for-4o', streamMs: 12 }] },
      { model: 'gpt-4o-mini', responses: [{ text: 'for-mini' }] },
    ]);
    expect(stub.pendingCount()).toBe(2);

    let first = '';
    await stub.streamCompletion({}, 'gpt-4o', emptyRequest, (ev) => {
      if (ev.type === 'text_delta') first += ev.delta;
    });
    expect(first).toBe('for-4o');

    let second = '';
    await stub.streamCompletion({}, 'gpt-4o-mini', emptyRequest, (ev) => {
      if (ev.type === 'text_delta') second += ev.delta;
    });
    expect(second).toBe('for-mini');
    expect(stub.pendingCount()).toBe(0);
  });

  it('title and planner can dequeue in parallel without stealing each other', async () => {
    const stub = new StubLlmProvider();
    stub.configure([
      { responses: [{ text: 'My Title' }] },
      { model: 'gpt-4o', responses: [{ text: '{"assistant_output":"plan"}' }] },
    ]);
    const titleRequest: LlmRequest = {
      messages: [
        textMessage('system', 'Your job is to title this conversation in 3-6 words based on the first user message.'),
        textMessage('user', 'hello'),
      ],
    };
    const plannerRequest: LlmRequest = {
      messages: [textMessage('user', 'Reply with one JSON object containing assistant_output.')],
    };
    const read = async (model: string, request: LlmRequest) => {
      let out = '';
      await stub.streamCompletion({}, model, request, (ev) => {
        if (ev.type === 'text_delta') out += ev.delta;
      });
      return out;
    };
    const [title, planner] = await Promise.all([
      read('gpt-4o', titleRequest),
      read('gpt-4o', plannerRequest),
    ]);
    expect(title).toBe('My Title');
    expect(planner).toBe('{"assistant_output":"plan"}');
    expect(stub.pendingCount()).toBe(0);
  });
});
