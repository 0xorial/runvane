import { rowToChatEntry } from './chat-entry.mapper.js';
import type { ChatEntryDbRow } from './chat-entries.types.js';

function row(type: string, payload: unknown): ChatEntryDbRow {
  return {
    id: 'e1',
    conversation_id: 'c1',
    conversation_index: 3,
    parent_id: 'p1',
    is_side: 0,
    type,
    payload_json: JSON.stringify(payload),
    created_at: new Date('2026-07-15T00:00:00.000Z'),
  };
}

describe('rowToChatEntry: unified context-injection entry', () => {
  it('maps a files source (was the context-injection entry)', () => {
    const entry = rowToChatEntry(
      row('context-injection', {
        source: 'files',
        files: [{ path: '/x/README.md', fileType: 'instructions', status: 'injected' }],
        content: '# hi',
      }),
    );
    expect(entry).toMatchObject({
      type: 'context-injection',
      source: 'files',
      content: '# hi',
      files: [{ path: '/x/README.md', status: 'injected' }],
    });
  });

  it('maps a rag source in pending state (was the retrieval entry, mid-flight)', () => {
    const entry = rowToChatEntry(
      row('context-injection', {
        source: 'rag',
        state: 'pending',
        queries: [],
        storages: ['Docs'],
        hits: [],
      }),
    );
    expect(entry).toMatchObject({ type: 'context-injection', source: 'rag', state: 'pending', storages: ['Docs'] });
  });

  it('maps a resolved rag source with hits', () => {
    const entry = rowToChatEntry(
      row('context-injection', {
        source: 'rag',
        state: 'done',
        queries: [{ text: 'q', origin: 'verbatim' }],
        storages: ['Docs'],
        hits: [{ storage: 'Docs', source: 'a.md', chunkIndex: 0, score: 0.9, origin: 'seed', text: 't' }],
      }),
    );
    expect(entry).toMatchObject({ type: 'context-injection', source: 'rag', state: 'done' });
    expect(entry.type === 'context-injection' && entry.hits?.length).toBe(1);
  });

  it('rejects a files row that is missing its source discriminant (would dead-stream SSE)', () => {
    // Post-migration invariant: every files row must carry source:'files'.
    expect(() => rowToChatEntry(row('context-injection', { files: [], content: '' }))).toThrow();
  });

  it('rejects a rag row missing required rag fields', () => {
    expect(() => rowToChatEntry(row('context-injection', { source: 'rag', state: 'done' }))).toThrow();
  });

  it('no longer recognizes the old retrieval type', () => {
    expect(() => rowToChatEntry(row('retrieval', { source: 'rag', state: 'done', queries: [], storages: [], hits: [] }))).toThrow(
      /unknown chat entry type/,
    );
  });
});
