import { mergeLlmUsage, parseOpenRouterGenerationData } from './openRouterGeneration.js';

describe('parseOpenRouterGenerationData', () => {
  it('parses token counts and total_cost from generation API payload', () => {
    const usage = parseOpenRouterGenerationData({
      tokens_prompt: 1200,
      tokens_completion: 45,
      native_tokens_cached: 800,
      total_cost: 0.01234,
      cancelled: true,
    });
    expect(usage).toEqual({
      promptTokens: 1200,
      completionTokens: 45,
      cachedPromptTokens: 800,
      costUsd: 0.01234,
    });
  });
});

describe('mergeLlmUsage', () => {
  it('prefers generation API cost over partial stream usage', () => {
    const merged = mergeLlmUsage(
      { promptTokens: 100, completionTokens: 10, costUsd: 0.5 },
      { promptTokens: 90, completionTokens: 5 },
    );
    expect(merged?.costUsd).toBe(0.5);
    expect(merged?.promptTokens).toBe(100);
  });
});
