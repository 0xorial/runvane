import { Injectable, Logger } from '@nestjs/common';
import path from 'node:path';
import { zerialize } from 'zodex';
import { BaseTool, type ToolRunContext } from '../../base-tool.js';
import { IngestRunner } from '../../../rag/ingestion/ingest-runner.service.js';
import { RagWatchService } from '../../../rag/watch/rag-watch.service.js';
import { RetrieverService } from '../../../rag/retrieval/retriever.service.js';
import { scanRootCandidates } from '../../../rag/sources/root-scanner.js';
import { StorageRegistry } from '../../../rag/store/storage-registry.service.js';
import { parseRagToolParams, ragToolParamsSchema, type RagToolParams } from './params.js';
import { parseRagToolRules, RagToolRulesSchema, type RagToolRules } from './rules.js';

@Injectable()
export class RagTool extends BaseTool<RagToolParams, RagToolRules> {
  private readonly logger = new Logger(RagTool.name);

  constructor(
    private readonly retriever: RetrieverService,
    private readonly storages: StorageRegistry,
    private readonly ingestRunner: IngestRunner,
    private readonly watcher: RagWatchService,
  ) {
    super();
  }

  getName(): string {
    return 'rag';
  }

  getAiDescription(): string {
    return (
      'Semantic retrieval over the agent\'s configured RAG storages, plus source management. ' +
      'operation "query" (default): returns the most relevant indexed chunks with source and ' +
      'similarity score; with the "graph" strategy, results may add knowledge-graph-connected ' +
      'chunks (origin "graph") and a graph block of entities/relations. ' +
      'operation "suggest_sources": explore a base directory and get candidate folders worth ' +
      'indexing (file counts + samples) — judge them yourself, nothing is added automatically. ' +
      'operation "add_source": add root folders to a configured storage and re-index it ' +
      '(requires the allow_source_changes rule). Use suggest_sources before add_source when the ' +
      'user asks to index something and the exact folders are unclear.'
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
    return { storages: [], top_k: 8, strategy: 'simple', max_hops: 1, allow_source_changes: false };
  }

  parseParams(raw: unknown): RagToolParams {
    return parseRagToolParams(raw);
  }

  parseRules(raw: unknown): RagToolRules {
    return parseRagToolRules(raw);
  }

  async runTool(params: RagToolParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseRagToolRules(context.toolRules ?? this.getDefaultRules());
    if (params.operation === 'suggest_sources') return this.suggestSources(params);
    if (params.operation === 'add_source') return this.addSource(params, rules);

    if (!params.query) throw new Error('rag: operation "query" needs the `query` parameter');
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

  /** Explore a base dir and return candidate roots — the model judges them. */
  private async suggestSources(params: RagToolParams): Promise<unknown> {
    if (!params.base) throw new Error('rag: operation "suggest_sources" needs the `base` parameter');
    const candidates = await scanRootCandidates(params.base);
    return {
      operation: 'suggest_sources',
      base: params.base,
      count: candidates.length,
      candidates: candidates.map((c) => ({
        path: c.path,
        relative: c.relative || '.',
        files: c.files,
        samples: c.samples,
      })),
      ...(candidates.length === 0 ? { note: 'No indexable text found under that base.' } : {}),
    };
  }

  /** Add roots to one of the agent's storages and re-index in the background. */
  private async addSource(params: RagToolParams, rules: RagToolRules): Promise<unknown> {
    if (!rules.allow_source_changes) {
      throw new Error(
        'rag: add_source is disabled for this agent — enable the allow_source_changes rule to let it modify storage sources',
      );
    }
    const roots = (params.roots ?? []).map((r) => r.trim()).filter(Boolean);
    if (roots.length === 0) throw new Error('rag: operation "add_source" needs non-empty `roots`');
    for (const root of roots) {
      if (!path.isAbsolute(root)) {
        throw new Error(`rag: add_source roots must be absolute paths ('${root}' is not)`);
      }
    }

    const configured = rules.storages
      .map((id) => this.storages.getManifest(id))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (configured.length === 0) throw new Error('rag: no storages configured for this agent');
    const wanted = params.storage?.trim();
    const manifest = wanted
      ? configured.find((m) => m.id === wanted || m.name === wanted)
      : configured.length === 1
        ? configured[0]
        : undefined;
    if (!manifest) {
      const names = configured.map((m) => m.name).join(', ');
      throw new Error(
        wanted
          ? `rag: storage '${wanted}' is not among this agent's storages (${names})`
          : `rag: multiple storages configured — pass \`storage\` to pick one (${names})`,
      );
    }

    const existing = Array.isArray(manifest.sourceParams.roots)
      ? (manifest.sourceParams.roots as unknown[]).map(String)
      : [];
    const merged = [...existing];
    const added: string[] = [];
    for (const root of roots) {
      if (!merged.includes(root)) {
        merged.push(root);
        added.push(root);
      }
    }
    if (added.length > 0) {
      this.storages.updateManifest(manifest.id, {
        sourceParams: { ...manifest.sourceParams, roots: merged },
      });
      // The watcher holds the old roots; re-subscribe with the new ones.
      if (manifest.watch) this.watcher.restart(manifest.id);
    }
    // Re-index in the background — progress shows as a running task.
    void this.ingestRunner.run(manifest.id, 'manual').catch((error) => {
      this.logger.warn(`add_source ingest of '${manifest.id}' failed: ${String(error)}`);
    });
    return {
      operation: 'add_source',
      storage: { id: manifest.id, name: manifest.name },
      roots_added: added,
      roots_total: merged.length,
      ingest: 'started',
      note: 'Indexing runs in the background; new content becomes retrievable as it completes.',
    };
  }
}
