import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import { getCompletionText, textMessage, type LlmMessage } from '../../llmProviders/types.js';
import type { SourceGraphInput } from '../store/knowledge-store.types.js';
import type {
  GraphBuilder,
  GraphBuilderInput,
  GraphExtractionResult,
  GraphExtractionUsage,
} from './graph-builder.js';

/** Hard caps so one noisy document can't flood the graph. */
const MAX_ENTITIES = 50;
const MAX_RELATIONS = 100;
const MAX_NAME_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 500;
/** Merged (multi-fragment) descriptions may run longer than a single
 *  extraction's cap; the ingest-time summarize pass condenses them back. */
const MAX_MERGED_DESCRIPTION_CHARS = 2000;

const LlmGraphParamsSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    /** Documents longer than this many chunks are truncated for extraction
     *  (their chunks are still embedded/stored in full). */
    maxChunks: z.number().finite().int().min(1).max(200).default(40),
    /** LightRAG-style gleaning: after the first pass, re-prompt up to this
     *  many times for entities/relations the model missed. Each round is one
     *  more LLM call per changed source item; a round that adds nothing stops
     *  the loop early. 0 = single-pass extraction. */
    maxGleaning: z.number().finite().int().min(0).max(3).default(1),
  })
  .strict();

export type LlmGraphParams = z.infer<typeof LlmGraphParamsSchema>;

const ExtractionReplySchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string(),
        type: z.string().optional(),
        description: z.string().optional(),
        chunks: z.array(z.number().int().min(0)).optional(),
      }),
    )
    .default([]),
  relations: z
    .array(
      z.object({
        source: z.string(),
        target: z.string(),
        relation: z.string(),
        description: z.string().optional(),
      }),
    )
    .default([]),
});

/**
 * Parse the model's extraction reply into the normalized graph contract.
 * Tolerates fenced/prefixed replies by slicing the outermost JSON object.
 * Entities' `chunks` arrays become mention rows; entities without one get no
 * mention here — ingestion backfills mentions by scanning chunk texts.
 */
export function parseExtractionReply(reply: string): SourceGraphInput {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('graph extraction reply contains no JSON object');
  const parsed = ExtractionReplySchema.parse(JSON.parse(reply.slice(start, end + 1)));

  const clip = (s: string, max: number): string => s.trim().slice(0, max);
  const nodes: SourceGraphInput['nodes'] = [];
  const mentions: SourceGraphInput['mentions'] = [];
  for (const entity of parsed.entities.slice(0, MAX_ENTITIES)) {
    const name = clip(entity.name, MAX_NAME_CHARS);
    if (!name) continue;
    nodes.push({
      name,
      type: entity.type ? clip(entity.type, MAX_NAME_CHARS) : undefined,
      description: entity.description ? clip(entity.description, MAX_DESCRIPTION_CHARS) : undefined,
    });
    for (const chunkIndex of entity.chunks ?? []) mentions.push({ node: name, chunkIndex });
  }

  const edges: SourceGraphInput['edges'] = [];
  for (const relation of parsed.relations.slice(0, MAX_RELATIONS)) {
    const source = clip(relation.source, MAX_NAME_CHARS);
    const target = clip(relation.target, MAX_NAME_CHARS);
    const label = clip(relation.relation, MAX_NAME_CHARS);
    if (!source || !target || !label) continue;
    edges.push({
      source,
      target,
      relation: label,
      description: relation.description ? clip(relation.description, MAX_DESCRIPTION_CHARS) : undefined,
    });
  }

  return { nodes, edges, mentions };
}

/**
 * Merge a gleaning round's additions into the running extraction. Nodes dedupe
 * case/whitespace-insensitively (first type wins unless empty; distinct
 * description fragments accumulate " | "-joined); edges dedupe by
 * (source, target, relation); mentions by (node, chunkIndex). Inputs are not
 * mutated. `addedNodes`/`addedEdges` let the gleaning loop stop when a round
 * contributed nothing new.
 */
export function mergeExtractions(
  base: SourceGraphInput,
  extra: SourceGraphInput,
): { merged: SourceGraphInput; addedNodes: number; addedEdges: number } {
  const keyOf = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ');

  const nodes = base.nodes.map((n) => ({ ...n }));
  const nodeByKey = new Map(nodes.map((n) => [keyOf(n.name), n]));
  let addedNodes = 0;
  for (const node of extra.nodes) {
    const existing = nodeByKey.get(keyOf(node.name));
    if (!existing) {
      const copy = { ...node };
      nodeByKey.set(keyOf(copy.name), copy);
      nodes.push(copy);
      addedNodes += 1;
      continue;
    }
    if (!existing.type && node.type) existing.type = node.type;
    if (node.description && !(existing.description ?? '').includes(node.description)) {
      existing.description = (
        existing.description ? `${existing.description} | ${node.description}` : node.description
      ).slice(0, MAX_MERGED_DESCRIPTION_CHARS);
    }
  }

  const edgeKey = (e: SourceGraphInput['edges'][number]): string =>
    `${keyOf(e.source)}|${keyOf(e.target)}|${e.relation.trim().toLowerCase()}`;
  const edges = [...base.edges];
  const seenEdges = new Set(edges.map(edgeKey));
  let addedEdges = 0;
  for (const edge of extra.edges) {
    if (seenEdges.has(edgeKey(edge))) continue;
    seenEdges.add(edgeKey(edge));
    edges.push({ ...edge });
    addedEdges += 1;
  }

  const mentionKey = (m: SourceGraphInput['mentions'][number]): string => `${keyOf(m.node)}|${m.chunkIndex}`;
  const mentions = [...base.mentions];
  const seenMentions = new Set(mentions.map(mentionKey));
  for (const mention of extra.mentions) {
    if (seenMentions.has(mentionKey(mention))) continue;
    seenMentions.add(mentionKey(mention));
    mentions.push({ ...mention });
  }

  return { merged: { nodes, edges, mentions }, addedNodes, addedEdges };
}

/** Matched by the stub provider — keep in sync with stubIsGraphExtractionRequest. */
export const GRAPH_EXTRACTION_SYSTEM_PROMPT =
  'You extract a knowledge graph from a document. Reply with ONLY one JSON object, no commentary:\n' +
  '{"entities":[{"name":"...","type":"...","description":"...","chunks":[0]}],' +
  '"relations":[{"source":"...","target":"...","relation":"...","description":"..."}]}\n' +
  'Rules: entity names are short canonical noun phrases (deduplicate aliases to one name); ' +
  '"type" is a coarse category such as person, organization, service, concept, location, event; ' +
  '"description" is 1-2 sentences on the entity\'s attributes and role as stated in THIS document; ' +
  '"chunks" lists the [chunk N] indexes where the entity appears; relations connect entity names with ' +
  'a concise verb phrase, plus a short description of how they are related; ' +
  `at most ${MAX_ENTITIES} entities and ${MAX_RELATIONS} relations, preferring the most load-bearing ones.`;

/** Gleaning re-prompt — matched by the stub provider (keep in sync with
 *  stubGraphExtractionReply's gleaning branch). */
export const GRAPH_GLEANING_USER_PROMPT =
  'Some entities or relations may have been MISSED in the previous extraction. Add ONLY the missing ' +
  'ones, in the same JSON format — do not repeat anything already extracted. If nothing was missed, ' +
  'reply {"entities":[],"relations":[]}.';

/** Matched by the stub provider — keep in sync with stubIsGraphSummarizeRequest. */
export const GRAPH_SUMMARIZE_SYSTEM_PROMPT =
  'You merge fragmented descriptions of one knowledge-graph entity into a single coherent description. ' +
  'The fragments were extracted from different documents and are separated by " | ". Write 1-3 ' +
  'sentences in third person covering the most load-bearing facts from all fragments; resolve ' +
  'contradictions by preferring the reading most fragments support. Reply with ONLY the merged ' +
  'description text.';

/**
 * The built-in graph builder: LLM extraction routed through the same provider
 * registry/settings as chat + embeddings, so it works with any configured
 * provider (including a local LM Studio) and adds no dependencies. Ports the
 * two load-bearing LightRAG ideas natively: multi-pass gleaning at extraction
 * time, and description summarization for entities that accumulate fragments
 * across documents (invoked by ingestion via `summarizeNodeDescription`).
 */
@Injectable()
export class LlmGraphBuilder implements GraphBuilder {
  readonly type = 'llm';
  readonly label = 'LLM extraction';

  constructor(
    private readonly providers: LlmProviderRegistry,
    private readonly providerSettings: LlmProviderSettingsRepo,
  ) {}

  parseParams(raw: Record<string, unknown>): LlmGraphParams {
    return LlmGraphParamsSchema.parse(raw);
  }

  validateParams(params: Record<string, unknown>): void {
    const parsed = this.parseParams(params);
    if (!this.providers.get(parsed.providerId)) {
      throw new Error(`unknown provider '${parsed.providerId}'`);
    }
  }

  async extract(input: GraphBuilderInput, signal?: AbortSignal): Promise<GraphExtractionResult> {
    const params = this.parseParams(input.params);
    const { provider, settings } = await this.resolveProvider(params);

    const chunks = input.chunks.slice(0, params.maxChunks);
    const doc = chunks.map((chunk) => `[chunk ${chunk.index}]\n${chunk.text}`).join('\n\n');
    const label =
      typeof input.item.metadata.relativePath === 'string'
        ? input.item.metadata.relativePath
        : input.item.sourceId;

    const messages: LlmMessage[] = [
      textMessage('system', GRAPH_EXTRACTION_SYSTEM_PROMPT),
      textMessage('user', `Document: ${label}\n\n${doc}`),
    ];
    const usage: GraphExtractionUsage = { llmCalls: 0, promptTokens: 0, completionTokens: 0, costUsd: null };
    const runOnce = async (): Promise<SourceGraphInput> => {
      const completion = await provider.streamCompletion(
        settings,
        params.model,
        { messages: [...messages] },
        () => {},
        signal,
      );
      usage.llmCalls += 1;
      usage.promptTokens += completion.usage?.promptTokens ?? 0;
      usage.completionTokens += completion.usage?.completionTokens ?? 0;
      if (typeof completion.usage?.costUsd === 'number') {
        usage.costUsd = (usage.costUsd ?? 0) + completion.usage.costUsd;
      }
      const reply = getCompletionText(completion);
      messages.push(textMessage('assistant', reply));
      return parseExtractionReply(reply);
    };

    let graph = await runOnce();
    for (let round = 0; round < params.maxGleaning; round += 1) {
      signal?.throwIfAborted();
      messages.push(textMessage('user', GRAPH_GLEANING_USER_PROMPT));
      let addition: SourceGraphInput;
      try {
        addition = await runOnce();
      } catch {
        // A malformed gleaning reply must not discard the good first pass.
        signal?.throwIfAborted();
        break;
      }
      const { merged, addedNodes, addedEdges } = mergeExtractions(graph, addition);
      graph = merged;
      if (addedNodes === 0 && addedEdges === 0) break;
    }
    return { graph, usage };
  }

  async summarizeNodeDescription(
    input: { name: string; type: string; description: string; params: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<{ description: string; usage: GraphExtractionUsage | null }> {
    const params = this.parseParams(input.params);
    const { provider, settings } = await this.resolveProvider(params);
    const completion = await provider.streamCompletion(
      settings,
      params.model,
      {
        messages: [
          textMessage('system', GRAPH_SUMMARIZE_SYSTEM_PROMPT),
          textMessage(
            'user',
            `Entity: ${input.name}${input.type ? ` (${input.type})` : ''}\nFragments:\n${input.description}`,
          ),
        ],
      },
      () => {},
      signal,
    );
    return {
      description: getCompletionText(completion).trim().slice(0, MAX_DESCRIPTION_CHARS),
      usage: {
        llmCalls: 1,
        promptTokens: completion.usage?.promptTokens ?? 0,
        completionTokens: completion.usage?.completionTokens ?? 0,
        costUsd: typeof completion.usage?.costUsd === 'number' ? completion.usage.costUsd : null,
      },
    };
  }

  private async resolveProvider(params: LlmGraphParams) {
    const provider = this.providers.get(params.providerId);
    if (!provider) throw new Error(`graph llm builder: unknown provider '${params.providerId}'`);
    const settings = await this.providerSettings.getProviderSettings(params.providerId);
    if (!settings) throw new Error(`graph llm builder: no settings for provider '${params.providerId}'`);
    return { provider, settings };
  }
}
