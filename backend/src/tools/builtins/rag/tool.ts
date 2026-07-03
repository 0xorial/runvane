import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import { BaseTool, type ToolRunContext } from '../../base-tool.js';
import { RetrieverService } from '../../../rag/retrieval/retriever.service.js';
import { StorageRegistry } from '../../../rag/store/storage-registry.service.js';
import { parseRagToolParams, ragToolParamsSchema, type RagToolParams } from './params.js';
import { parseRagToolRules, RagToolRulesSchema, type RagToolRules } from './rules.js';

@Injectable()
export class RagTool extends BaseTool<RagToolParams, RagToolRules> {
  constructor(
    private readonly retriever: RetrieverService,
    private readonly storages: StorageRegistry,
  ) {
    super();
  }

  getName(): string {
    return 'rag';
  }

  getAiDescription(): string {
    return (
      'Semantic retrieval over the agent\'s configured RAG storages. Returns the most relevant ' +
      'indexed text chunks with their source and similarity score. Prefer this over keyword search ' +
      'when you need meaning-based recall rather than an exact substring. When the agent\'s strategy ' +
      'is "graph", results may add chunks connected via the knowledge graph (origin "graph") plus ' +
      'a graph block listing the entities and relations that linked them.'
    );
  }

  getHumanDescription(): string {
    return 'Semantic search over configured RAG storages.';
  }

  getParamsSchema(): unknown {
    return ragToolParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(RagToolRulesSchema);
  }

  getDefaultRules(): RagToolRules {
    return { storages: [], top_k: 8, strategy: 'simple', max_hops: 1 };
  }

  parseParams(raw: unknown): RagToolParams {
    return parseRagToolParams(raw);
  }

  parseRules(raw: unknown): RagToolRules {
    return parseRagToolRules(raw);
  }

  async runTool(params: RagToolParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseRagToolRules(context.toolRules ?? this.getDefaultRules());
    if (rules.storages.length === 0) {
      return { query: params.query, count: 0, hits: [], note: 'No RAG storages configured for this agent.' };
    }
    const topK = Math.min(params.top_k ?? rules.top_k, rules.top_k);
    const retrieveInput = {
      storageIds: rules.storages,
      query: params.query,
      topK,
      signal: context.signal,
    };
    const { hits, graph } =
      rules.strategy === 'graph'
        ? await this.retriever.retrieveGraph({ ...retrieveInput, maxHops: rules.max_hops })
        : { hits: await this.retriever.retrieve(retrieveInput), graph: null };
    // Full retrieval trace so a user can drill into what ran from the tool row.
    const searched = rules.storages.map(
      (id) => this.storages.getManifest(id)?.name ?? `${id} (missing)`,
    );
    return {
      query: params.query,
      strategy: rules.strategy,
      ...(rules.strategy === 'graph' ? { max_hops: rules.max_hops } : {}),
      storages: searched,
      top_k: topK,
      count: hits.length,
      hits: hits.map((hit) => ({
        storage: hit.storageName,
        source: typeof hit.metadata.relativePath === 'string' ? hit.metadata.relativePath : hit.sourceId,
        score: Number(hit.score.toFixed(4)),
        origin: hit.origin,
        text: hit.text,
      })),
      ...(graph
        ? {
            graph: {
              entities: graph.entities,
              relations: graph.relations.map(
                (r) => `${r.source} —${r.relation}→ ${r.target}` + (r.description ? ` (${r.description})` : ''),
              ),
            },
          }
        : {}),
    };
  }
}
