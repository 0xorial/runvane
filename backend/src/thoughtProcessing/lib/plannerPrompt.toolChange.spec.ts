import { describe, expect, it } from '@jest/globals';
import { buildPlannerMessages, describeToolChange, extractToolOperations } from './plannerPrompt.js';
import { filesystemParamsSchema } from '../../tools/builtins/filesystem/params.js';

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

describe('extractToolOperations', () => {
  it('pulls the operation enum from a dispatch tool schema', () => {
    const schema = { type: 'object', properties: { operation: { enum: ['read_file', 'grep', 'stat'] } } };
    expect(extractToolOperations(schema)).toEqual(['read_file', 'grep', 'stat']);
  });

  it('returns [] when there is no operation enum', () => {
    expect(extractToolOperations({ type: 'object', properties: { command: { type: 'string' } } })).toEqual([]);
    expect(extractToolOperations({})).toEqual([]);
    expect(extractToolOperations(null)).toEqual([]);
  });

  it('works on the real filesystem tool JSON-Schema (z.toJSONSchema output)', () => {
    expect(extractToolOperations(filesystemParamsSchema())).toEqual([
      'read_file',
      'list_dir',
      'grep',
      'stat',
      'write_file',
      'edit_file',
    ]);
  });
});

describe('plannerSystemContent tool block', () => {
  it('lists each tool with description and operations', () => {
    const messages = buildPlannerMessages({
      systemPrompt: 'sys',
      entries: [],
      tools: [
        { name: 'filesystem', description: 'Read files and more.', operations: ['read_file', 'grep'] },
        { name: 'web_search', description: 'Search the web.', operations: [] },
      ],
    });
    const sys = JSON.stringify(messages[0]);
    expect(sys).toContain('- filesystem — Read files and more. Operations: read_file, grep.');
    expect(sys).toContain('- web_search — Search the web.');
    expect(sys).not.toContain('web_search —  Operations'); // no empty operations clause
  });

  it('renders (none) when no tools are available', () => {
    const messages = buildPlannerMessages({ systemPrompt: 'sys', entries: [], tools: [] });
    expect(JSON.stringify(messages[0])).toContain('Tools: (none)');
  });
});

describe('buildPlannerMessages tool-change note', () => {
  const base = { systemPrompt: 'sys', entries: [], tools: [{ name: 'a', description: '', operations: [] }] };

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
