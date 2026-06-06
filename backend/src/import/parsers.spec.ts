import { parseGeminiExport } from './gemini.parser.js';
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
});
