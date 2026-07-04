import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import { getCompletionText, textMessage, type LlmRequest } from '../../llmProviders/types.js';
import type { SourceGraphInput } from '../store/rag-store.types.js';
import type { GraphBuilder, GraphBuilderInput, GraphExtractionResult } from './graph-builder.js';

/** Hard caps so one noisy document can't flood the graph. */
const MAX_ENTITIES = 50;
const MAX_RELATIONS = 100;
const MAX_NAME_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 500;

const LlmGraphParamsSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    /** Documents longer than this many chunks are truncated for extraction
     *  (their chunks are still embedded/stored in full). */
    maxChunks: z.number().finite().int().min(1).max(200).default(40),
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

/** Matched by the stub provider — keep in sync with stubIsGraphExtractionRequest. */
export const GRAPH_EXTRACTION_SYSTEM_PROMPT =
  'You extract a knowledge graph from a document. Reply with ONLY one JSON object, no commentary:\n' +
  '{"entities":[{"name":"...","type":"...","description":"...","chunks":[0]}],' +
  '"relations":[{"source":"...","target":"...","relation":"...","description":"..."}]}\n' +
  'Rules: entity names are short canonical noun phrases (deduplicate aliases to one name); ' +
  '"chunks" lists the [chunk N] indexes where the entity appears; relations connect entity names ' +
  `with a concise verb phrase; at most ${MAX_ENTITIES} entities and ${MAX_RELATIONS} relations, ` +
  'preferring the most load-bearing ones.';

/**
 * The built-in graph builder: one LLM call per source item, routed through the
 * same provider registry/settings as chat + embeddings, so it works with any
 * configured provider (including a local LM Studio) and adds no dependencies.
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
    const provider = this.providers.get(params.providerId);
    if (!provider) throw new Error(`graph llm builder: unknown provider '${params.providerId}'`);
    const settings = await this.providerSettings.getProviderSettings(params.providerId);
    if (!settings) throw new Error(`graph llm builder: no settings for provider '${params.providerId}'`);

    const chunks = input.chunks.slice(0, params.maxChunks);
    const doc = chunks.map((chunk) => `[chunk ${chunk.index}]\n${chunk.text}`).join('\n\n');
    const label =
      typeof input.item.metadata.relativePath === 'string'
        ? input.item.metadata.relativePath
        : input.item.sourceId;
    const request: LlmRequest = {
      messages: [
        textMessage('system', GRAPH_EXTRACTION_SYSTEM_PROMPT),
        textMessage('user', `Document: ${label}\n\n${doc}`),
      ],
    };

    const completion = await provider.streamCompletion(settings, params.model, request, () => {}, signal);
    return {
      graph: parseExtractionReply(getCompletionText(completion)),
      usage: {
        llmCalls: 1,
        promptTokens: completion.usage?.promptTokens ?? 0,
        completionTokens: completion.usage?.completionTokens ?? 0,
        costUsd: typeof completion.usage?.costUsd === 'number' ? completion.usage.costUsd : null,
      },
    };
  }
}
