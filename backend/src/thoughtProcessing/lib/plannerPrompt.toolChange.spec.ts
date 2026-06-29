import { describe, expect, it } from '@jest/globals';
import { buildPlannerMessages, describeToolChange } from './plannerPrompt.js';

describe('describeToolChange', () => {
  it('returns undefined when the effective tool set is unchanged (incl. flip-and-back)', () => {
    expect(describeToolChange(['a', 'b'], ['a', 'b'])).toBeUndefined();
    // order-insensitive
    expect(describeToolChange(['a', 'b'], ['b', 'a'])).toBeUndefined();
  });

  it('reports newly available tools', () => {
    expect(describeToolChange(['a'], ['a', 'web_search'])).toBe(
      "[The user changed this conversation's tools for this turn] Newly available: web_search.",
    );
  });

  it('reports removed tools', () => {
    expect(describeToolChange(['a', 'bash'], ['a'])).toBe(
      "[The user changed this conversation's tools for this turn] No longer available: bash.",
    );
  });

  it('reports both directions in one note', () => {
    const note = describeToolChange(['bash'], ['web_search']);
    expect(note).toContain('Newly available: web_search.');
    expect(note).toContain('No longer available: bash.');
  });
});

describe('buildPlannerMessages tool-change note', () => {
  const base = { systemPrompt: 'sys', entries: [], toolIds: ['a'] };

  it('omits the note when toolChangeNote is absent', () => {
    const messages = buildPlannerMessages(base);
    expect(messages.filter((m) => m.role === 'system')).toHaveLength(1); // just the planner system prompt
  });

  it('appends the note as a trailing system message when present', () => {
    const messages = buildPlannerMessages({ ...base, toolChangeNote: 'CHANGED: x' });
    const last = messages[messages.length - 1];
    expect(last.role).toBe('system');
    expect(JSON.stringify(last)).toContain('CHANGED: x');
  });
});
