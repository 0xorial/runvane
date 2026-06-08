import { parseAutoImport } from './auto.parser.js';
import { parseClaudeExport } from './claude.parser.js';
import { parseGeminiExport } from './gemini.parser.js';
import { parseGrokExport } from './grok.parser.js';
import { parseOpenAiExport } from './openai.parser.js';

describe('chat history parsers', () => {
  it('parses OpenAI simple export', () => {
    const rows = parseOpenAiExport([
      {
        title: 'Demo',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi there' },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messages).toHaveLength(2);
  });

  it('parses Gemini export wrapper', () => {
    const rows = parseGeminiExport({
      conversations: [
        {
          title: 'Gem',
          messages: [
            { role: 'user', content: 'q' },
            { role: 'model', content: 'a' },
          ],
        },
      ],
    });
    expect(rows[0]?.messages[1]?.role).toBe('assistant');
  });

  it('parses Claude export with content blocks', () => {
    const rows = parseClaudeExport([
      {
        name: 'Claude chat',
        chat_messages: [
          { sender: 'human', text: 'hello claude' },
          {
            sender: 'assistant',
            content: [
              { type: 'thinking', text: 'hidden' },
              { type: 'text', text: 'hello back' },
            ],
          },
        ],
      },
    ]);
    expect(rows[0]?.title).toBe('Claude chat');
    expect(rows[0]?.messages[1]?.content).toBe('hello back');
  });

  it('parses Grok export with wrapped responses', () => {
    const rows = parseGrokExport([
      {
        conversation: { title: 'Grok chat' },
        responses: [
          { response: { sender: 'human', message: 'question' } },
          { sender: 'assistant', message: 'answer' },
        ],
      },
    ]);
    expect(rows[0]?.messages.map((row) => row.content)).toEqual(['question', 'answer']);
  });

  it('auto-detects Claude export', () => {
    const detected = parseAutoImport([
      {
        name: 'Auto Claude',
        chat_messages: [{ sender: 'human', text: 'hi' }],
      },
    ]);
    expect(detected.format).toBe('claude');
    expect(detected.conversations[0]?.title).toBe('Auto Claude');
  });
});
