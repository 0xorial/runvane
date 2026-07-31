import { Injectable, Logger } from '@nestjs/common';
import path from 'node:path';
import { zerialize } from 'zodex';
import { AgentsService } from '../../../agents/agents.service.js';
import { BaseTool, type ToolRunContext } from '../../base-tool.js';
import { GraphBuilderRegistry } from '../../../knowledge/graph/graph-builder.registry.js';
import { IngestRunner } from '../../../knowledge/ingestion/ingest-runner.service.js';
import { KnowledgeWatchService } from '../../../knowledge/watch/knowledge-watch.service.js';
import { RetrieverService } from '../../../knowledge/retrieval/retriever.service.js';
import { scanRootCandidates } from '../../../knowledge/sources/root-scanner.js';
import { StorageRegistry } from '../../../knowledge/store/storage-registry.service.js';
import { parseKnowledgeToolParams, knowledgeToolParamsSchema, type KnowledgeToolParams } from './params.js';
import { parseKnowledgeToolRules, KnowledgeToolRulesSchema, type KnowledgeToolRules } from './rules.js';

@Injectable()
export class KnowledgeTool extends BaseTool<KnowledgeToolParams, KnowledgeToolRules> {
  private readonly logger = new Logger(KnowledgeTool.name);

  constructor(
    private readonly retriever: RetrieverService,
    private readonly storages: StorageRegistry,
    private readonly ingestRunner: IngestRunner,
    private readonly watcher: KnowledgeWatchService,
    private readonly graphBuilders: GraphBuilderRegistry,
    private readonly agents: AgentsService,
  ) {
    super();
  }

  getName(): string {
    return 'knowledge';
  }

  getAiDescription(): string {
    return (
      "Semantic search over the agent's indexed knowledge bases, plus source management. " +
      'Use for CONCEPTUAL recall — meaning, topics, "where is X discussed". For exact identifiers ' +
      'or error strings, prefer grep/file tools: embeddings rank paraphrases, not literals.'
    );
  }

  getHumanDescription(): string {
    return 'Semantic search over the agent\'s knowledge bases.';
  }

  getParamsSchema(): unknown {
    return knowledgeToolParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(KnowledgeToolRulesSchema);
  }

  getDefaultRules(): KnowledgeToolRules {
    return { storages: [], top_k: 8, strategy: 'simple', max_hops: 1, allow_source_changes: false };
  }

  parseParams(raw: unknown): KnowledgeToolParams {
    return parseKnowledgeToolParams(raw);
  }

  parseRules(raw: unknown): KnowledgeToolRules {
    return parseKnowledgeToolRules(raw);
  }

  async runTool(params: KnowledgeToolParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseKnowledgeToolRules(context.toolRules ?? this.getDefaultRules());
    if (params.operation === 'list_storages') return this.listStorages(params, rules);
    if (params.operation === 'read_source') return this.readSource(params, rules);
    if (params.operation === 'suggest_sources') return this.suggestSources(params);
    if (params.operation === 'add_source') return this.addSource(params, rules, context);
    if (params.operation === 'create_storage') return this.createStorage(params, rules, context);

    if (!params.query) throw new Error('knowledge: operation "query" needs the `query` parameter');
    if (rules.storages.length === 0) {
      return { query: params.query, count: 0, hits: [], note: 'No knowledge bases configured for this agent.' };
    }
    const topK = Math.min(params.top_k ?? rules.top_k, rules.top_k);
    context.log?.(`retrieving top ${topK} for "${params.query}" across ${rules.storages.length} storage(s), strategy ${rules.strategy}`);
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
    context.log?.(`${hits.length} hit(s)`);
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

  /**
   * Orientation: the storages this agent may search, with live counts and
   * roots — returned as a tool RESULT, never rendered into the description
   * (cache-safety, plan doc D9). With `storage`, also lists its sources.
   */
  private listStorages(params: KnowledgeToolParams, rules: KnowledgeToolRules): unknown {
    const configured = rules.storages
      .map((id) => {
        const manifest = this.storages.getManifest(id);
        if (!manifest) return { id, missing: true as const };
        const store = this.storages.open(id);
        const counts = store?.counts();
        return {
          id: manifest.id,
          name: manifest.name,
          sources: counts?.sources ?? 0,
          chunks: counts?.chunks ?? 0,
          graph: manifest.graph ? { nodes: counts?.nodes ?? 0, edges: counts?.edges ?? 0 } : null,
          roots: Array.isArray(manifest.sourceParams.roots)
            ? (manifest.sourceParams.roots as unknown[]).map(String)
            : [],
        };
      })
      .filter(Boolean);
    const wanted = params.storage?.trim();
    let sourceListing: unknown;
    if (wanted) {
      const manifest = rules.storages
        .map((id) => this.storages.getManifest(id))
        .find((m) => m && (m.id === wanted || m.name === wanted));
      if (!manifest) throw new Error(`knowledge: storage '${wanted}' is not among this agent's storages`);
      sourceListing = {
        storage: manifest.name,
        sources: this.storages.open(manifest.id)?.listSources() ?? [],
      };
    }
    return {
      operation: 'list_storages',
      count: configured.length,
      storages: configured,
      ...(sourceListing ? { source_listing: sourceListing } : {}),
      ...(configured.length === 0 ? { note: 'No knowledge bases configured for this agent.' } : {}),
    };
  }

  /** Full text of one indexed source — the follow-up when query hits show the
   *  right document but the chunks alone are not enough context. */
  private readSource(params: KnowledgeToolParams, rules: KnowledgeToolRules): unknown {
    const ref = params.source?.trim();
    if (!ref) throw new Error('knowledge: operation "read_source" needs the `source` parameter');
    const configured = rules.storages
      .map((id) => this.storages.getManifest(id))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (configured.length === 0) {
      throw new Error('knowledge: no storages configured for this agent');
    }
    const wanted = params.storage?.trim();
    const candidates = wanted
      ? configured.filter((m) => m.id === wanted || m.name === wanted)
      : configured;
    if (wanted && candidates.length === 0) {
      throw new Error(`knowledge: storage '${wanted}' is not among this agent's storages`);
    }
    for (const manifest of candidates) {
      const found = this.storages.open(manifest.id)?.readSource(ref);
      if (found) {
        return {
          operation: 'read_source',
          storage: manifest.name,
          source: found.label,
          chars: found.text.length,
          ...(found.truncated ? { truncated: true } : {}),
          text: found.text,
        };
      }
    }
    throw new Error(
      `knowledge: source '${ref}' not found in ${wanted ? `storage '${wanted}'` : "this agent's storages"} — ` +
        'use the `source` label from a query hit or list_storages',
    );
  }

  /** Explore a base dir and return candidate roots — the model judges them. */
  private async suggestSources(params: KnowledgeToolParams): Promise<unknown> {
    if (!params.base) throw new Error('knowledge: operation "suggest_sources" needs the `base` parameter');
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
   * immediately: the id is appended to the agent's stored knowledge rules, so the
   * next planner round can query/add_source it. The model only supplies a
   * name and (optionally) initial roots — embedding/graph choices come from
   * `storage_defaults`, which the user set in agent settings.
   */
  private async createStorage(
    params: KnowledgeToolParams,
    rules: KnowledgeToolRules,
    context: ToolRunContext,
  ): Promise<unknown> {
    if (!rules.allow_source_changes) {
      throw new Error(
        'knowledge: create_storage is disabled for this agent — enable the allow_source_changes rule first',
      );
    }
    const defaults = rules.storage_defaults;
    if (!defaults) {
      throw new Error(
        'knowledge: create_storage needs the storage_defaults rule (embedding provider/model template) — ' +
          "set it in this agent's knowledge rules; storage creation from chat never picks models on its own",
      );
    }
    const name = params.name?.trim();
    if (!name) throw new Error('knowledge: operation "create_storage" needs the `name` parameter');
    if (this.storages.listManifests().some((m) => m.name === name)) {
      throw new Error(
        `knowledge: a storage named '${name}' already exists — use add_source (storage: '${name}') to grow it`,
      );
    }
    const roots = (params.roots ?? []).map((r) => r.trim()).filter(Boolean);
    for (const root of roots) {
      if (!path.isAbsolute(root)) {
        throw new Error(`knowledge: create_storage roots must be absolute paths ('${root}' is not)`);
      }
    }
    const graph = defaults.graph ?? null;
    if (graph && !this.graphBuilders.get(graph.builder)) {
      throw new Error(`knowledge: storage_defaults references unknown graph builder '${graph.builder}'`);
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

    // Make it visible to future turns: append to the agent's stored knowledge rules.
    let agentUpdated = false;
    if (context.agentId) {
      try {
        const agent = await this.agents.get(context.agentId);
        const cfg = (agent?.default_llm_configuration ?? {}) as {
          tools?: Record<string, { rules?: Record<string, unknown> }>;
        } & Record<string, unknown>;
        const tools = (cfg.tools ??= {});
        const knowledgeTool = (tools.knowledge ??= {});
        const knowledgeRules = (knowledgeTool.rules ??= {});
        const list = Array.isArray(knowledgeRules.storages) ? (knowledgeRules.storages as unknown[]).map(String) : [];
        if (!list.includes(manifest.id)) list.push(manifest.id);
        knowledgeRules.storages = list;
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
        ? "Storage added to this agent's knowledge storages; it becomes queryable as indexing completes."
        : "Storage created, but it could not be added to the agent's knowledge rules automatically — add it in agent settings.",
    };
  }

  /** Add roots to one of the agent's storages and re-index in the background. */
  private async addSource(
    params: KnowledgeToolParams,
    rules: KnowledgeToolRules,
    context: ToolRunContext,
  ): Promise<unknown> {
    if (!rules.allow_source_changes) {
      throw new Error(
        'knowledge: add_source is disabled for this agent — enable the allow_source_changes rule to let it modify storage sources',
      );
    }
    const roots = (params.roots ?? []).map((r) => r.trim()).filter(Boolean);
    if (roots.length === 0) throw new Error('knowledge: operation "add_source" needs non-empty `roots`');
    for (const root of roots) {
      if (!path.isAbsolute(root)) {
        throw new Error(`knowledge: add_source roots must be absolute paths ('${root}' is not)`);
      }
    }

    const configured = rules.storages
      .map((id) => this.storages.getManifest(id))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (configured.length === 0) {
      throw new Error(
        'knowledge: no storages configured for this agent' +
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
          ? `knowledge: storage '${wanted}' is not among this agent's storages (${names})`
          : `knowledge: multiple storages configured — pass \`storage\` to pick one (${names})`,
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
