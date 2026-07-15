/**
 * A knowledge-indexable entity type. Each source knows how to enumerate its items as
 * plain text + metadata; the ingestion pipeline chunks, embeds, and stores
 * them. New entity types (conversations, facts, graph knowledge) implement
 * this interface and are registered alongside the files source.
 */
export type SourceItem = {
  /** Stable id within this source (e.g. absolute file path, conversation id). */
  sourceId: string;
  /** Full text content to be chunked + embedded. */
  text: string;
  /** Hash of the item's content; lets ingestion skip unchanged items. */
  contentHash: string;
  /** Display/provenance metadata surfaced on retrieval hits. */
  metadata: Record<string, unknown>;
};

export interface EntitySource {
  /** Stable identifier persisted in a storage manifest, e.g. 'files'. */
  readonly type: string;
  /** Human label for the config UI. */
  readonly label: string;
  /** Stream current items for the given source params. */
  enumerate(params: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<SourceItem>;
  /**
   * Optional: subscribe to change notifications for the given params, calling
   * `onChange` on any potentially relevant change (the caller debounces and
   * re-ingests; false positives are cheap thanks to hash-skipping). Watching
   * is best-effort: log-and-continue on errors, stop when `signal` aborts,
   * and never hold the process open.
   */
  watch?(params: Record<string, unknown>, onChange: () => void, signal: AbortSignal): void;
}

/** DI token: the array of available entity sources. */
export const ENTITY_SOURCES = Symbol('ENTITY_SOURCES');
