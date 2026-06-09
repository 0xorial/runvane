import { retainSharedTestApp } from '../support/shared-app';

const runLive = process.env.RUN_INTEGRATION_TESTS === '1';
const describeLive = runLive ? describe : describe.skip;

describeLive('chat history import (integration)', () => {
  let baseUrl: string;

  beforeAll(async () => {
    const testApp = await retainSharedTestApp();
    baseUrl = testApp.baseUrl;
  }, 30_000);

  it('imports OpenAI simple export into conversations', async () => {
    const res = await fetch(`${baseUrl}/api/import/openai`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        {
          title: 'Imported OpenAI',
          messages: [
            { role: 'user', content: 'hello import' },
            { role: 'assistant', content: 'hello back' },
          ],
        },
      ]),
    });
    if (!res.ok) throw new Error(`POST /api/import/openai failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { imported?: number; conversationIds?: string[] };
    expect(body.imported).toBe(1);
    expect(body.conversationIds?.[0]).toBeTruthy();

    const messagesRes = await fetch(
      `${baseUrl}/api/conversations/${encodeURIComponent(body.conversationIds![0]!)}/messages?all=1`,
    );
    const messages = (await messagesRes.json()) as Array<{ type: string; text?: string }>;
    expect(messages.some((entry) => entry.type === 'user-message' && entry.text === 'hello import')).toBe(true);
    expect(messages.some((entry) => entry.type === 'assistant-message' && entry.text === 'hello back')).toBe(true);
  });

  it('imports Claude export', async () => {
    const res = await fetch(`${baseUrl}/api/import/claude`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        {
          name: 'Imported Claude',
          chat_messages: [
            { sender: 'human', text: 'claude hello' },
            { sender: 'assistant', text: 'claude hi' },
          ],
        },
      ]),
    });
    if (!res.ok) throw new Error(`POST /api/import/claude failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { conversationIds?: string[] };
    const conversationId = body.conversationIds?.[0];
    if (!conversationId) throw new Error('import claude: missing conversation id');

    const messagesRes = await fetch(
      `${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages?all=1`,
    );
    const messages = (await messagesRes.json()) as Array<{ type: string; text?: string }>;
    expect(messages.some((entry) => entry.type === 'user-message' && entry.text === 'claude hello')).toBe(true);
  });

  it('imports Grok export via auto-detect', async () => {
    const res = await fetch(`${baseUrl}/api/import/auto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        {
          conversation: { title: 'Imported Grok' },
          responses: [
            { sender: 'human', message: 'grok hello' },
            { sender: 'assistant', message: 'grok hi' },
          ],
        },
      ]),
    });
    if (!res.ok) throw new Error(`POST /api/import/auto failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { format?: string; conversationIds?: string[] };
    expect(body.format).toBe('grok');
    const conversationId = body.conversationIds?.[0];
    if (!conversationId) throw new Error('import auto: missing conversation id');

    const messagesRes = await fetch(
      `${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages?all=1`,
    );
    const messages = (await messagesRes.json()) as Array<{ type: string; text?: string }>;
    expect(messages.some((entry) => entry.type === 'user-message' && entry.text === 'grok hello')).toBe(true);
  });
});
