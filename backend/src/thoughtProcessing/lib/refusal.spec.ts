import type { LlmCompletion } from '../../llmProviders/types.js';
import { refusalMessage, refusedCompletion } from './refusal.js';

describe('refusedCompletion', () => {
  it('is true for a content_filter finish with no text and no tool calls', () => {
    const completion: LlmCompletion = { parts: [], finishReason: 'content_filter' };
    expect(refusedCompletion(completion)).toBe(true);
  });

  it('is false when the filter still returned text (partial output is a reply)', () => {
    const completion: LlmCompletion = { parts: [{ kind: 'text', text: 'partial' }], finishReason: 'content_filter' };
    expect(refusedCompletion(completion)).toBe(false);
  });

  it('is false for an ordinary empty stop (handled as a no-op elsewhere)', () => {
    const completion: LlmCompletion = { parts: [], finishReason: 'stop' };
    expect(refusedCompletion(completion)).toBe(false);
  });

  it('names the model and says nothing ran', () => {
    expect(refusalMessage('claude-opus-5-5')).toMatch(/^claude-opus-5-5 refused this request: .*nothing ran\./);
  });
});
