import { describe, expect, it } from '@jest/globals';
import type { ChatEntry } from '../contracts/chatEntry.js';
import { hydrateThoughtInput, serializeThoughtInput, stripThoughtInputJson } from './inputSnapshot.js';
import type { PlannerInput } from './thoughtTypeProviders/plannerProvider.js';

function thoughtEntry(overrides: Partial<Extract<ChatEntry, { type: 'thought' }>> = {}): ChatEntry {
  return {
    type: 'thought',
    id: 'thought-old',
    conversationIndex: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    parentId: null,
    isSide: false,
    thoughtType: 'planner',
    stage: 'reason',
    status: 'running',
    llmRequest: '{}',
    inputJson: '{"entries":[...]}',
    ...overrides,
  };
}

describe('inputSnapshot', () => {
  it('serializes planner input as a leaf pointer, not embedded entries', () => {
    const input: PlannerInput = {
      conversationId: 'conv-1',
      agentId: 'agent-1',
      systemPrompt: 'be helpful',
      enabledToolIds: ['get_current_time'],
      entries: [thoughtEntry()],
    };
    const raw = serializeThoughtInput(input, 'thought-new');
    expect(raw.length).toBeLessThan(500);
    const parsed = JSON.parse(raw) as { kind: string; leafEntryId: string; entries?: unknown };
    expect(parsed.kind).toBe('planner');
    expect(parsed.leafEntryId).toBe('thought-new');
    expect(parsed.entries).toBeUndefined();
  });

  it('hydrates legacy planner blobs without nested inputJson on entries', async () => {
    const legacy: PlannerInput = {
      conversationId: 'conv-1',
      agentId: 'agent-1',
      systemPrompt: 'sys',
      enabledToolIds: [],
      entries: [thoughtEntry({ conversationIndex: 0, inputJson: '{"huge":true}' })],
    };
    const hydrated = (await hydrateThoughtInput(
      { listChatEntriesFromLeaf: async () => legacy.entries } as never,
      JSON.stringify(legacy),
    )) as PlannerInput;
    expect(hydrated.entries[0]?.type).toBe('thought');
    expect((hydrated.entries[0] as { inputJson?: string }).inputJson).toBeUndefined();
  });

  it('strips inputJson from thought rows for client export', () => {
    const stripped = stripThoughtInputJson(thoughtEntry({ id: 'p1', conversationIndex: 0, inputJson: '{"v":1}' }));
    expect((stripped as { inputJson?: string }).inputJson).toBeUndefined();
  });
});
