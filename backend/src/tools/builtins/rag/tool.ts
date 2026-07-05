import { Injectable, Logger } from '@nestjs/common';
import path from 'node:path';
import { zerialize } from 'zodex';
import { AgentsService } from '../../../agents/agents.service.js';
import { BaseTool, type ToolRunContext } from '../../base-tool.js';
import { GraphBuilderRegistry } from '../../../rag/graph/graph-builder.registry.js';
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
    private readonly graphBuilders: GraphBuilderRegistry,
    private readonly agents: AgentsService,
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
      '(requires the allow_source_changes rule). ' +
      'operation "create_storage": when no suitable storage exists, create one from the ' +
      'agent-configured template — pass a short name and optionally initial roots ' +
      '(requires allow_source_changes and configured storage_defaults). ' +
      'Use suggest_sources first when the user asks to index something and the exact folders are unclear.'
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
    if (params.operation === 'add_source') return this.addSource(params, rules, context);
    if (params.operation === 'create_storage') return this.createStorage(params, rules, context);

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

  /**
   * Create a storage from the agent's configured template and make it usable
   * immediately: the id is appended to the agent's stored rag rules, so the
   * next planner round can query/add_source it. The model only supplies a
   * name and (optionally) initial roots — embedding/graph choices come from
   * `storage_defaults`, which the user set in agent settings.
   */
  private async createStorage(
    params: RagToolParams,
    rules: RagToolRules,
    context: ToolRunContext,
  ): Promise<unknown> {
    if (!rules.allow_source_changes) {
      throw new Error(
        'rag: create_storage is disabled for this agent — enable the allow_source_changes rule first',
      );
    }
    const defaults = rules.storage_defaults;
    if (!defaults) {
      throw new Error(
        'rag: create_storage needs the storage_defaults rule (embedding provider/model template) — ' +
          "set it in this agent's rag rules; storage creation from chat never picks models on its own",
      );
    }
    const name = params.name?.trim();
    if (!name) throw new Error('rag: operation "create_storage" needs the `name` parameter');
    if (this.storages.listManifests().some((m) => m.name === name)) {
      throw new Error(
        `rag: a storage named '${name}' already exists — use add_source (storage: '${name}') to grow it`,
      );
    }
    const roots = (params.roots ?? []).map((r) => r.trim()).filter(Boolean);
    for (const root of roots) {
      if (!path.isAbsolute(root)) {
        throw new Error(`rag: create_storage roots must be absolute paths ('${root}' is not)`);
      }
    }
    const graph = defaults.graph ?? null;
    if (graph && !this.graphBuilders.get(graph.builder)) {
      throw new Error(`rag: storage_defaults references unknown graph builder '${graph.builder}'`);
    }

    const manifest = this.storages.create(
      {
        name,
        entitySource: 'files',
        embeddingProviderId: defaults.embeddingProviderId,
        embeddingModel: defaults.embeddingModel,
        sourceParams: { roots },
        graph,
        watch: defaults.watch,
      },
      'agent',
      { conversation_id: context.conversationId, agent_id: context.agentId },
    );

    // Make it visible to future turns: append to the agent's stored rag rules.
    let agentUpdated = false;
    if (context.agentId) {
      try {
        const agent = await this.agents.get(context.agentId);
        const cfg = (agent?.default_llm_configuration ?? {}) as {
          tools?: Record<string, { rules?: Record<string, unknown> }>;
        } & Record<string, unknown>;
        const tools = (cfg.tools ??= {});
        const ragTool = (tools.rag ??= {});
        const ragRules = (ragTool.rules ??= {});
        const list = Array.isArray(ragRules.storages) ? (ragRules.storages as unknown[]).map(String) : [];
        if (!list.includes(manifest.id)) list.push(manifest.id);
        ragRules.storages = list;
        agentUpdated =
          (await this.agents.update(context.agentId, { default_llm_configuration: cfg } as never)) !== null;
      } catch (error) {
        this.logger.warn(`create_storage: could not add '${manifest.id}' to agent rules: ${String(error)}`);
      }
    }

    if (defaults.watch) this.watcher.reconcile();
    if (roots.length > 0) {
      void this.ingestRunner.run(manifest.id, 'agent').catch((error) => {
        this.logger.warn(`create_storage ingest of '${manifest.id}' failed: ${String(error)}`);
      });
    }
    return {
      operation: 'create_storage',
      storage: { id: manifest.id, name: manifest.name },
      embedding: `${defaults.embeddingProviderId}/${defaults.embeddingModel}`,
      graph: graph?.builder ?? null,
      watch: defaults.watch,
      roots,
      ingest: roots.length > 0 ? 'started' : 'skipped (no roots yet — use add_source)',
      note: agentUpdated
        ? "Storage added to this agent's rag storages; it becomes queryable as indexing completes."
        : "Storage created, but it could not be added to the agent's rag rules automatically — add it in agent settings.",
    };
  }

  /** Add roots to one of the agent's storages and re-index in the background. */
  private async addSource(
    params: RagToolParams,
    rules: RagToolRules,
    context: ToolRunContext,
  ): Promise<unknown> {
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
    if (configured.length === 0) {
      throw new Error(
        'rag: no storages configured for this agent' +
          (rules.storage_defaults
            ? ' — use operation "create_storage" (with a name and these roots) to create one first'
            : ''),
      );
    }
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
      this.storages.open(manifest.id)?.appendLog('source_added', 'agent', {
        roots: added,
        conversation_id: context.conversationId,
        agent_id: context.agentId,
      });
      // The watcher holds the old roots; re-subscribe with the new ones.
      if (manifest.watch) this.watcher.restart(manifest.id);
    }
    // Re-index in the background — progress shows as a running task.
    void this.ingestRunner.run(manifest.id, 'agent').catch((error) => {
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
