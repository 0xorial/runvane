import { describe, expect, it } from '@jest/globals';
import type { ChatEntry } from '../contracts/chatEntry.js';
import { hydrateThoughtInput, serializeThoughtInput, stripPrepareInputJson } from './inputSnapshot.js';
import type { PlannerInput } from './thoughtTypeProviders/plannerProvider.js';

describe('inputSnapshot', () => {
  it('serializes planner input as a leaf pointer, not embedded entries', () => {
    const input: PlannerInput = {
      conversationId: 'conv-1',
      agentId: 'agent-1',
      systemPrompt: 'be helpful',
      enabledToolIds: ['get_current_time'],
      entries: [
        {
          type: 'thought-prepare',
          id: 'prep-old',
          conversationIndex: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          parentId: null,
          thoughtId: 't-old',
          requestText: '{}',
          inputJson: '{"entries":[...]}',
        } as ChatEntry,
      ],
    };
    const raw = serializeThoughtInput(input, 'prep-new');
    expect(raw.length).toBeLessThan(500);
    const parsed = JSON.parse(raw) as { kind: string; leafEntryId: string; entries?: unknown };
    expect(parsed.kind).toBe('planner');
    expect(parsed.leafEntryId).toBe('prep-new');
    expect(parsed.entries).toBeUndefined();
  });

  it('hydrates legacy planner blobs without nested inputJson on entries', async () => {
    const legacy: PlannerInput = {
      conversationId: 'conv-1',
      agentId: 'agent-1',
      systemPrompt: 'sys',
      enabledToolIds: [],
      entries: [
        {
          type: 'thought-prepare',
          id: 'prep-old',
          conversationIndex: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          parentId: null,
          thoughtId: 't-old',
          requestText: '{}',
          inputJson: '{"huge":true}',
        } as ChatEntry,
      ],
    };
    const hydrated = (await hydrateThoughtInput(
      { listChatEntriesFromLeaf: async () => legacy.entries } as never,
      JSON.stringify(legacy),
    )) as PlannerInput;
    expect(hydrated.entries[0]?.type).toBe('thought-prepare');
    expect((hydrated.entries[0] as { inputJson?: string }).inputJson).toBeUndefined();
  });

  it('strips inputJson from prepare rows for client export', () => {
    const stripped = stripPrepareInputJson({
      type: 'thought-prepare',
      id: 'p1',
      conversationIndex: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      parentId: null,
      thoughtId: 't1',
      requestText: '{}',
      inputJson: '{"v":1}',
    });
    expect((stripped as { inputJson?: string }).inputJson).toBeUndefined();
  });
});
