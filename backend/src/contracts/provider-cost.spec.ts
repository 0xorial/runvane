import { providerCostBreakdownFromUsage, providerCostEntryFieldsFromUsage } from './provider-cost.js';

describe('providerCostEntryFieldsFromUsage', () => {
  it('maps LlmUsage to provider_cost and breakdown', () => {
    expect(
      providerCostEntryFieldsFromUsage({
        promptTokens: 1200,
        completionTokens: 45,
        cachedPromptTokens: 800,
        costUsd: 0.01234,
      }),
    ).toEqual({
      provider_cost: 0.01234,
      provider_cost_breakdown: { input: 400, output: 45, cached: 800 },
    });
  });

  it('omits provider_cost when cost is unknown', () => {
    expect(
      providerCostEntryFieldsFromUsage({ promptTokens: 100, completionTokens: 20 }),
    ).toEqual({
      provider_cost_breakdown: { input: 100, output: 20, cached: 0 },
    });
  });
});

describe('providerCostBreakdownFromUsage', () => {
  it('treats promptTokens as total input including cached', () => {
    expect(providerCostBreakdownFromUsage({ promptTokens: 500, completionTokens: 10, cachedPromptTokens: 400 })).toEqual({
      input: 100,
      output: 10,
      cached: 400,
    });
  });
});
