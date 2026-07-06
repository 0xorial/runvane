import { extractAssistantPreviewFromStream } from './plannerOutput.js';

// The live assistant-message mirror feeds on partially streamed planner
// replies; these pin the visible/withheld split for both reply families.
describe('extractAssistantPreviewFromStream', () => {
  it('streams plain text as-is', () => {
    expect(extractAssistantPreviewFromStream('Hello there, the answer is 42.')).toBe(
      'Hello there, the answer is 42.',
    );
  });

  it('extracts a partially streamed assistant_output JSON field', () => {
    expect(extractAssistantPreviewFromStream('{"assistant_output": "Hel')).toBe('Hel');
    expect(extractAssistantPreviewFromStream('```json\n{"assistant_output": "Hi", "tool')).toBe('Hi');
  });

  it('shows nothing while a structured reply has no output field yet', () => {
    expect(extractAssistantPreviewFromStream('{"tool_requests": [{"na')).toBe('');
    expect(extractAssistantPreviewFromStream('```json\n{"to')).toBe('');
  });

  it('cuts at a deepseek tool-calls opener', () => {
    const text = 'The answer is 42.\n<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>rag';
    expect(extractAssistantPreviewFromStream(text)).toBe('The answer is 42.');
  });

  it('withholds a half-received marker tail', () => {
    expect(extractAssistantPreviewFromStream('The answer is 42.\n<｜tool▁ca')).toBe('The answer is 42.\n');
    expect(extractAssistantPreviewFromStream('Sure.[TOOL_CA')).toBe('Sure.');
    expect(extractAssistantPreviewFromStream('Done. <function_ca')).toBe('Done. ');
  });

  it('releases prose that only looked like a marker', () => {
    expect(extractAssistantPreviewFromStream('for x < y the result grows')).toBe(
      'for x < y the result grows',
    );
  });

  it('cuts at mistral and xml-ish openers', () => {
    expect(extractAssistantPreviewFromStream('Sure.[TOOL_CALLS][{"name"')).toBe('Sure.');
    expect(extractAssistantPreviewFromStream('Done.\n<function_calls>\n<invoke')).toBe('Done.');
    expect(extractAssistantPreviewFromStream('Done.\n<tool_call>{"name"')).toBe('Done.');
  });

  it('lets ordinary code fences stream but holds a forming tool_code fence', () => {
    expect(extractAssistantPreviewFromStream('Example:\n```py\nprint(1)\n```\ndone')).toBe(
      'Example:\n```py\nprint(1)\n```\ndone',
    );
    expect(extractAssistantPreviewFromStream('Example:\n```tool_cod')).toBe('Example:\n');
    expect(extractAssistantPreviewFromStream('Example:\n```tool_code\n{"name"')).toBe('Example:');
  });

  it('never mirrors inline think blocks', () => {
    expect(extractAssistantPreviewFromStream('<think>hmm, let me reason')).toBe('');
    expect(extractAssistantPreviewFromStream('<think>reasoning</think>\n\nThe answer is 42.')).toBe(
      'The answer is 42.',
    );
  });

  it('returns empty for empty input', () => {
    expect(extractAssistantPreviewFromStream('')).toBe('');
  });
});
