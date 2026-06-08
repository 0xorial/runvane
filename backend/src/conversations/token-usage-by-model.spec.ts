import { aggregateTokenUsageByModel } from './token-usage-by-model.js';

describe('aggregateTokenUsageByModel', () => {
  it('sums usage per model from stream payloads', () => {
    expect(
      aggregateTokenUsageByModel([
        {
          modelName: 'anthropic/claude-opus-4.7',
          payload: { promptTokens: 100, cachedPromptTokens: 40, completionTokens: 10 },
        },
        {
          modelName: 'anthropic/claude-opus-4.7',
          payload: { promptTokens: 200, completionTokens: 5 },
        },
      ]),
    ).toEqual([
      {
        modelName: 'anthropic/claude-opus-4.7',
        promptTokens: 300,
        cachedPromptTokens: 40,
        completionTokens: 15,
      },
    ]);
  });

  it('prefers provider_cost_breakdown when present', () => {
    expect(
      aggregateTokenUsageByModel([
        {
          modelName: 'anthropic/claude-opus-4.7',
          payload: {
            promptTokens: 999,
            provider_cost_breakdown: { input: 100, cached: 50, output: 20 },
          },
        },
      ]),
    ).toEqual([
      {
        modelName: 'anthropic/claude-opus-4.7',
        promptTokens: 150,
        cachedPromptTokens: 50,
        completionTokens: 20,
      },
    ]);
  });
});
