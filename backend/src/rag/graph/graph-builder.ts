import type { TextChunk } from '../chunker.js';
import type { SourceItem } from '../sources/entity-source.js';
import type { SourceGraphInput } from '../store/rag-store.types.js';

/**
 * A pluggable knowledge-graph extractor. Builders differ in *how* they derive
 * a graph (LLM prompt, external library, CLI/HTTP service) but all map their
 * output into the normalized `SourceGraphInput` contract — nodes, typed
 * edges, and optional chunk-level mentions — which is the only shape the
 * store and the retriever ever see. Plugging in a new engine (external
 * library, CLI, or HTTP service) is a new implementation of this interface
 * registered in ENTITY-SOURCE style; retrieval code never changes.
 */
export type GraphBuilderInput = {
  item: SourceItem;
  /** The exact chunks the ingestion pipeline stored (indexes must line up). */
  chunks: TextChunk[];
  /** Builder-specific params from the storage manifest (e.g. llm → { providerId, model }). */
  params: Record<string, unknown>;
};

/** LLM spend of one extraction — surfaced in the ingest task/activity log so
 *  background graph building is never invisible token burn. */
export type GraphExtractionUsage = {
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  /** Provider-reported USD, when the provider reports it; null otherwise. */
  costUsd: number | null;
};

export type GraphExtractionResult = {
  graph: SourceGraphInput;
  /** Null when the builder cannot account its calls. */
  usage: GraphExtractionUsage | null;
};

export interface GraphBuilder {
  /** Stable identifier persisted in a storage manifest, e.g. 'llm'. */
  readonly type: string;
  /** Human label for the config UI. */
  readonly label: string;
  /** Extract one source item's graph. Throwing marks the item's graph as failed
   *  (ingestion records it and continues); the item's chunks are still stored. */
  extract(input: GraphBuilderInput, signal?: AbortSignal): Promise<GraphExtractionResult>;
  /** Optional creation-time params check; throw with a human message on bad params. */
  validateParams?(params: Record<string, unknown>): void;
  /**
   * Optional: condense one node's accumulated description fragments (joined
   * with " | " as the same entity arrives from multiple sources) into a single
   * coherent description — the LightRAG-style incremental entity merge.
   * Ingestion calls this after an ingest run for nodes whose description grew
   * past a threshold; a throw skips that node and the run continues.
   */
  summarizeNodeDescription?(
    input: { name: string; type: string; description: string; params: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<{ description: string; usage: GraphExtractionUsage | null }>;
}

/** DI token: the array of available graph builders. */
export const GRAPH_BUILDERS = Symbol('GRAPH_BUILDERS');
