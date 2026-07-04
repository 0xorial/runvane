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
        providerCostUsd: null,
        providerCostComplete: false,
      },
    ]);
  });

  it('sums provider-reported cost and tracks completeness per model', () => {
    const rows = aggregateTokenUsageByModel([
      // Both turns reported → exact sum.
      { modelName: 'a', payload: { promptTokens: 10, completionTokens: 1, provider_cost: 0.01 } },
      { modelName: 'a', payload: { promptTokens: 10, completionTokens: 1, provider_cost: 0.02 } },
      // One of two turns reported → lower bound.
      { modelName: 'b', payload: { promptTokens: 10, completionTokens: 1, provider_cost: 0.5 } },
      { modelName: 'b', payload: { promptTokens: 10, completionTokens: 1 } },
      // Nothing reported → null, not $0.
      { modelName: 'c', payload: { promptTokens: 10, completionTokens: 1 } },
    ]);
    expect(
      rows.map(({ modelName, providerCostUsd, providerCostComplete }) => ({
        modelName,
        providerCostUsd,
        providerCostComplete,
      })),
    ).toEqual([
      { modelName: 'a', providerCostUsd: 0.03, providerCostComplete: true },
      { modelName: 'b', providerCostUsd: 0.5, providerCostComplete: false },
      { modelName: 'c', providerCostUsd: null, providerCostComplete: false },
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
        providerCostUsd: null,
        providerCostComplete: false,
      },
    ]);
  });
});
