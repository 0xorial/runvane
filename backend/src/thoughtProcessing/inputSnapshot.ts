import type { ChatEntry } from '../contracts/chatEntry.js';
import type { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import type { PlannerInput } from './thoughtTypeProviders/plannerProvider.js';
import type { SummarizeInput } from './thoughtTypeProviders/summarizeProvider.js';

const SNAPSHOT_VERSION = 1 as const;

type PlannerSnapshot = {
  v: typeof SNAPSHOT_VERSION;
  kind: 'planner';
  conversationId: string;
  agentId: string;
  systemPrompt: string;
  enabledToolIds: string[];
  /** Absent on snapshots persisted before direct-args prompt annotations. */
  directToolIds?: string[];
  leafEntryId: string;
};

type SummarizeSnapshot = {
  v: typeof SNAPSHOT_VERSION;
  kind: 'summarize';
  conversationId: string;
  fromEntryId: string;
  toEntryId: string;
  rangeEntryCount: number;
};

type PassthroughSnapshot = {
  v: typeof SNAPSHOT_VERSION;
  kind: 'passthrough';
  input: unknown;
};

const VISIBLE_SUMMARIZE_TYPES = new Set<ChatEntry['type']>([
  'user-message',
  'assistant-message',
  'tool-invocation',
  'checkpoint-summary',
]);

export function stripPrepareInputJson(entry: ChatEntry): ChatEntry {
  if (entry.type !== 'thought-prepare' || entry.inputJson === undefined) return entry;
  const { inputJson: _removed, ...rest } = entry;
  return rest as ChatEntry;
}

/** API/SSE: inputJson is server-only reprocess metadata, not client payload. */
export function toClientChatEntry(entry: ChatEntry): ChatEntry {
  return stripPrepareInputJson(entry);
}

function isPlannerInput(input: unknown): input is PlannerInput {
  if (!input || typeof input !== 'object') return false;
  const row = input as Record<string, unknown>;
  return (
    typeof row.conversationId === 'string' &&
    typeof row.agentId === 'string' &&
    typeof row.systemPrompt === 'string' &&
    Array.isArray(row.enabledToolIds) &&
    Array.isArray(row.entries)
  );
}

function isSummarizeInput(input: unknown): input is SummarizeInput {
  if (!input || typeof input !== 'object') return false;
  const row = input as Record<string, unknown>;
  return (
    typeof row.conversationId === 'string' &&
    typeof row.fromEntryId === 'string' &&
    typeof row.toEntryId === 'string' &&
    Array.isArray(row.rangeEntries)
  );
}

export function serializeThoughtInput(input: unknown, prepareEntryId: string): string {
  if (isPlannerInput(input)) {
    const snap: PlannerSnapshot = {
      v: SNAPSHOT_VERSION,
      kind: 'planner',
      conversationId: input.conversationId,
      agentId: input.agentId,
      systemPrompt: input.systemPrompt,
      enabledToolIds: input.enabledToolIds,
      ...(input.directToolIds ? { directToolIds: input.directToolIds } : {}),
      leafEntryId: prepareEntryId,
    };
    return JSON.stringify(snap);
  }
  if (isSummarizeInput(input)) {
    const snap: SummarizeSnapshot = {
      v: SNAPSHOT_VERSION,
      kind: 'summarize',
      conversationId: input.conversationId,
      fromEntryId: input.fromEntryId,
      toEntryId: input.toEntryId,
      rangeEntryCount: input.rangeEntryCount,
    };
    return JSON.stringify(snap);
  }
  const snap: PassthroughSnapshot = { v: SNAPSHOT_VERSION, kind: 'passthrough', input };
  return JSON.stringify(snap);
}

function legacyPlannerInput(input: unknown): PlannerInput | null {
  if (!isPlannerInput(input)) return null;
  return {
    conversationId: input.conversationId,
    agentId: input.agentId,
    systemPrompt: input.systemPrompt,
    enabledToolIds: input.enabledToolIds,
    entries: input.entries.map(stripPrepareInputJson),
  };
}

async function hydratePlannerInput(
  chatEntries: ChatEntriesRepo,
  snap: PlannerSnapshot,
): Promise<PlannerInput> {
  const entries = (await chatEntries.listChatEntriesFromLeaf(snap.conversationId, snap.leafEntryId)).map(
    stripPrepareInputJson,
  );
  return {
    conversationId: snap.conversationId,
    agentId: snap.agentId,
    systemPrompt: snap.systemPrompt,
    enabledToolIds: snap.enabledToolIds,
    ...(snap.directToolIds ? { directToolIds: snap.directToolIds } : {}),
    entries,
  };
}

async function hydrateSummarizeInput(
  chatEntries: ChatEntriesRepo,
  snap: SummarizeSnapshot,
): Promise<SummarizeInput> {
  const all = await chatEntries.listChatEntries(snap.conversationId, { all: true });
  const from = all.find((entry) => entry.id === snap.fromEntryId);
  const to = all.find((entry) => entry.id === snap.toEntryId);
  if (!from || !to) {
    throw new Error(
      `summarize snapshot: range endpoint missing (from=${snap.fromEntryId}, to=${snap.toEntryId})`,
    );
  }
  const lo = Math.min(from.conversationIndex, to.conversationIndex);
  const hi = Math.max(from.conversationIndex, to.conversationIndex);
  const rangeEntries = all
    .filter((entry) => entry.conversationIndex >= lo && entry.conversationIndex <= hi)
    .filter((entry) => VISIBLE_SUMMARIZE_TYPES.has(entry.type))
    .map(stripPrepareInputJson);
  return {
    conversationId: snap.conversationId,
    fromEntryId: snap.fromEntryId,
    toEntryId: snap.toEntryId,
    rangeEntries,
    rangeEntryCount: snap.rangeEntryCount,
  };
}

function parseSnapshot(inputJson: string): unknown {
  return JSON.parse(inputJson) as unknown;
}

function isVersionedSnapshot(parsed: unknown): parsed is { v: number; kind: string } {
  return Boolean(parsed && typeof parsed === 'object' && 'v' in parsed && 'kind' in parsed);
}

export async function hydrateThoughtInput(
  chatEntries: ChatEntriesRepo,
  inputJson: string,
): Promise<unknown> {
  const parsed = parseSnapshot(inputJson);
  const legacyPlanner = legacyPlannerInput(parsed);
  if (legacyPlanner) return legacyPlanner;

  if (!isVersionedSnapshot(parsed) || parsed.v !== SNAPSHOT_VERSION) {
    throw new Error('unrecognized thought inputJson snapshot');
  }

  switch (parsed.kind) {
    case 'planner':
      return hydratePlannerInput(chatEntries, parsed as PlannerSnapshot);
    case 'summarize':
      return hydrateSummarizeInput(chatEntries, parsed as SummarizeSnapshot);
    case 'passthrough':
      return (parsed as PassthroughSnapshot).input;
    default:
      throw new Error(`unrecognized thought inputJson snapshot kind: ${String(parsed.kind)}`);
  }
}
