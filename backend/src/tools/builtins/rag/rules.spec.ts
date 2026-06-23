import { parseRagToolRules } from './rules.js';

describe('parseRagToolRules (per-agent RAG config)', () => {
  it('applies defaults for an empty config', () => {
    expect(parseRagToolRules({})).toEqual({ allowed: 'ask', storages: [], top_k: 8, strategy: 'simple' });
  });

  it('preserves selected storages, top_k, and permission', () => {
    const rules = parseRagToolRules({ allowed: 'always', storages: ['s1', 's2'], top_k: 5, strategy: 'simple' });
    expect(rules.allowed).toBe('always');
    expect(rules.storages).toEqual(['s1', 's2']);
    expect(rules.top_k).toBe(5);
  });

  it('rejects out-of-range top_k', () => {
    expect(() => parseRagToolRules({ top_k: 0 })).toThrow();
    expect(() => parseRagToolRules({ top_k: 999 })).toThrow();
  });

  it('rejects unknown keys (strict schema)', () => {
    expect(() => parseRagToolRules({ bogus: true })).toThrow();
  });
});
