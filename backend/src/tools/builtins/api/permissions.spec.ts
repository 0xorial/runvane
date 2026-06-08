import { evaluateApiToolPermission } from './permissions.js';

describe('evaluateApiToolPermission', () => {
  it('never auto-allows even when rule is always', () => {
    expect(evaluateApiToolPermission('always')[0]?.permission).toBe('ask_user');
  });

  it('asks when rule is ask', () => {
    expect(evaluateApiToolPermission('ask')[0]?.permission).toBe('ask_user');
  });

  it('forbids when rule is never', () => {
    expect(evaluateApiToolPermission('never')[0]?.permission).toBe('forbid');
  });
});
