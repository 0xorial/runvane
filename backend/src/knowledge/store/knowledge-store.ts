import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { bufferToFloat32, dot, float32ToBuffer, l2normalize } from '../vector.js';
import type {
  ChunkInput,
  ChunkRef,
  KnowledgeLogActor,
  KnowledgeLogEntry,
  KnowledgeLogEvent,
  SourceGraphInput,
  StorageManifest,
  StoreCounts,
  StoredChunk,
  StoredChunkHit,
  StoredGraphEdge,
  StoredGraphNode,
} from './knowledge-store.types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  source_type  TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_count  INTEGER NOT NULL,
  updated_at   TEXT NOT NULL,
  graph_ok     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (source_type, source_id)
);
CREATE TABLE IF NOT EXISTS chunks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  chunk_index   INTEGER NOT NULL,
  text          TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  embedding     BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_type, source_id);
CREATE TABLE IF NOT EXISTS graph_nodes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS graph_edges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_node INTEGER NOT NULL,
  target_node INTEGER NOT NULL,
  relation    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_provenance ON graph_edges(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node);
CREATE TABLE IF NOT EXISTS graph_mentions (
  node_id     INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  PRIMARY KEY (node_id, source_type, source_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_graph_mentions_provenance ON graph_mentions(source_type, source_id);
CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  event       TEXT NOT NULL,
  actor       TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
`;

/** Case/whitespace-insensitive identity for node deduplication. */
export function nodeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function safeParseObject(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * One knowledge storage backed by a single SQLite file (via Node's built-in
 * `node:sqlite`), fully separate from the app's Prisma DB. Embeddings are
 * stored L2-normalized, so similarity is a brute-force dot product at query
 * time. The class is intentionally narrow so a future ANN/sqlite-vec backend
 * can replace it behind the same surface.
 */
export class KnowledgeStore {
  private readonly db: DatabaseSync;

  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(SCHEMA);
    // Storages created before the graph layer lack this column; CREATE TABLE
    // IF NOT EXISTS won't add it, so patch it in additively.
    const sourceCols = this.db.prepare(`PRAGMA table_info(sources)`).all() as Array<{ name: string }>;
    if (!sourceCols.some((c) => c.name === 'graph_ok')) {
      this.db.exec(`ALTER TABLE sources ADD COLUMN graph_ok INTEGER NOT NULL DEFAULT 1`);
    }
  }

  close(): void {
    this.db.close();
  }

  getManifest(): StorageManifest | null {
    const row = this.db.prepare(`SELECT value FROM meta WHERE key = 'manifest'`).get() as
      | { value?: string }
      | undefined;
    if (!row?.value) return null;
    return JSON.parse(row.value) as StorageManifest;
  }

  setManifest(manifest: StorageManifest): void {
    this.db
      .prepare(`INSERT INTO meta(key, value) VALUES('manifest', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(manifest));
  }

  /** Content hash recorded for a source item, or null if never ingested. */
  getSourceHash(sourceType: string, sourceId: string): string | null {
    return this.getSourceState(sourceType, sourceId)?.contentHash ?? null;
  }

  /** Hash + graph status for a source item; graphOk=false means the last
   *  graph extraction failed and the item should be re-ingested. */
  getSourceState(sourceType: string, sourceId: string): { contentHash: string; graphOk: boolean } | null {
    const row = this.db
      .prepare(`SELECT content_hash, graph_ok FROM sources WHERE source_type = ? AND source_id = ?`)
      .get(sourceType, sourceId) as { content_hash?: string; graph_ok?: number } | undefined;
    if (!row?.content_hash) return null;
    return { contentHash: row.content_hash, graphOk: Number(row.graph_ok ?? 1) !== 0 };
  }

  setSourceGraphStatus(sourceType: string, sourceId: string, ok: boolean): void {
    this.db
      .prepare(`UPDATE sources SET graph_ok = ? WHERE source_type = ? AND source_id = ?`)
      .run(ok ? 1 : 0, sourceType, sourceId);
  }

  /** Source ids currently indexed for a type (used to prune deleted items). */
  listSourceIds(sourceType: string): string[] {
    const rows = this.db
      .prepare(`SELECT source_id FROM sources WHERE source_type = ?`)
      .all(sourceType) as Array<{ source_id: string }>;
    return rows.map((r) => r.source_id);
  }

  /** Replace all chunks for one source item in a single transaction. */
  replaceSource(
    ref: { sourceType: string; sourceId: string; contentHash: string },
    chunks: ChunkInput[],
  ): void {
    const delChunks = this.db.prepare(`DELETE FROM chunks WHERE source_type = ? AND source_id = ?`);
    const insChunk = this.db.prepare(
      `INSERT INTO chunks(source_type, source_id, chunk_index, text, metadata_json, embedding)
       VALUES(?, ?, ?, ?, ?, ?)`,
    );
    const upSource = this.db.prepare(
      `INSERT INTO sources(source_type, source_id, content_hash, chunk_count, updated_at)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(source_type, source_id) DO UPDATE SET
         content_hash = excluded.content_hash,
         chunk_count  = excluded.chunk_count,
         updated_at   = excluded.updated_at`,
    );

    this.db.exec('BEGIN');
    try {
      delChunks.run(ref.sourceType, ref.sourceId);
      for (const chunk of chunks) {
        const normalized = l2normalize(chunk.embedding);
        insChunk.run(
          ref.sourceType,
          ref.sourceId,
          chunk.chunkIndex,
          chunk.text,
          JSON.stringify(chunk.metadata ?? {}),
          float32ToBuffer(normalized),
        );
      }
      upSource.run(ref.sourceType, ref.sourceId, ref.contentHash, chunks.length, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Drop a source item and all its chunks + graph rows (pruning orphan nodes). */
  deleteSource(sourceType: string, sourceId: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`DELETE FROM chunks WHERE source_type = ? AND source_id = ?`).run(sourceType, sourceId);
      this.db.prepare(`DELETE FROM sources WHERE source_type = ? AND source_id = ?`).run(sourceType, sourceId);
      this.deleteSourceGraphRows(sourceType, sourceId);
      this.pruneOrphanNodes();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  counts(): StoreCounts {
    const count = (table: string): number => {
      const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      return Number(row.n);
    };
    return {
      chunks: count('chunks'),
      sources: count('sources'),
      nodes: count('graph_nodes'),
      edges: count('graph_edges'),
    };
  }

  /** Indexed sources with their display label (relativePath when the chunks
   *  carry one, else the raw source id) — the knowledge tool's orientation surface. */
  listSources(limit = 200): Array<{ sourceId: string; label: string; chunks: number }> {
    const rows = this.db
      .prepare(
        `SELECT s.source_id AS sourceId, s.chunk_count AS chunks,
                (SELECT json_extract(c.metadata_json, '$.relativePath') FROM chunks c
                 WHERE c.source_type = s.source_type AND c.source_id = s.source_id LIMIT 1) AS rel
         FROM sources s ORDER BY s.source_id ASC LIMIT ?`,
      )
      .all(limit) as Array<{ sourceId: string; chunks: number; rel: string | null }>;
    return rows.map((r) => ({ sourceId: r.sourceId, label: r.rel ?? r.sourceId, chunks: Number(r.chunks) }));
  }

  /** Full text of one indexed source (chunks re-joined in order), addressed by
   *  source id or by the relativePath label hits/listSources expose. */
  readSource(
    ref: string,
    maxChars = 24_000,
  ): { sourceId: string; label: string; text: string; truncated: boolean } | null {
    const rows = this.db
      .prepare(
        `SELECT source_id AS sourceId, chunk_index, text, metadata_json FROM chunks
         WHERE source_id = ? OR json_extract(metadata_json, '$.relativePath') = ?
         ORDER BY source_id ASC, chunk_index ASC`,
      )
      .all(ref, ref) as Array<{ sourceId: string; chunk_index: number; text: string; metadata_json: string }>;
    if (rows.length === 0) return null;
    // A ref could in theory label multiple sources: keep the first.
    const sourceId = rows[0]!.sourceId;
    const mine = rows.filter((r) => r.sourceId === sourceId);
    const rel = safeParseObject(mine[0]!.metadata_json).relativePath;
    const text = mine.map((r) => r.text).join('\n');
    const truncated = text.length > maxChars;
    return {
      sourceId,
      label: typeof rel === 'string' ? rel : sourceId,
      text: truncated ? text.slice(0, maxChars) : text,
      truncated,
    };
  }

  /**
   * Replace one source item's contribution to the knowledge graph. Nodes are
   * global (deduplicated by `nodeKey`) and merged on conflict — an empty type
   * never overwrites a set one, and distinct description fragments accumulate
   * " | "-joined (capped) rather than last/longest-wins, so an entity seen
   * across many sources keeps what each said about it. The ingest-time
   * summarize pass condenses fragments that grow past a threshold (see
   * `nodesWithLongDescriptions`). Edges and mentions carry per-source
   * provenance so a re-ingest of one item replaces exactly its own rows;
   * nodes left without any mention or edge are pruned.
   */
  replaceSourceGraph(ref: { sourceType: string; sourceId: string }, graph: SourceGraphInput): void {
    const upsertNode = this.db.prepare(
      `INSERT INTO graph_nodes(key, name, type, description) VALUES(?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         type        = CASE WHEN excluded.type <> '' THEN excluded.type ELSE graph_nodes.type END,
         description = CASE
           WHEN excluded.description = '' THEN graph_nodes.description
           WHEN graph_nodes.description = '' THEN excluded.description
           WHEN instr(graph_nodes.description, excluded.description) > 0 THEN graph_nodes.description
           ELSE substr(graph_nodes.description || ' | ' || excluded.description, 1, 4000)
         END`,
    );
    const nodeIdByKey = this.db.prepare(`SELECT id FROM graph_nodes WHERE key = ?`);
    const insEdge = this.db.prepare(
      `INSERT INTO graph_edges(source_node, target_node, relation, description, source_type, source_id)
       VALUES(?, ?, ?, ?, ?, ?)`,
    );
    const insMention = this.db.prepare(
      `INSERT OR IGNORE INTO graph_mentions(node_id, source_type, source_id, chunk_index)
       VALUES(?, ?, ?, ?)`,
    );

    this.db.exec('BEGIN');
    try {
      this.deleteSourceGraphRows(ref.sourceType, ref.sourceId);

      const idFor = (name: string, type = '', description = ''): number | null => {
        const key = nodeKey(name);
        if (!key) return null;
        upsertNode.run(key, name.trim(), type.trim(), description.trim());
        const row = nodeIdByKey.get(key) as { id: number } | undefined;
        return row ? Number(row.id) : null;
      };

      for (const node of graph.nodes) idFor(node.name, node.type ?? '', node.description ?? '');

      const seenEdges = new Set<string>();
      for (const edge of graph.edges) {
        const sourceId = idFor(edge.source);
        const targetId = idFor(edge.target);
        const relation = edge.relation.trim();
        if (sourceId === null || targetId === null || !relation || sourceId === targetId) continue;
        const dedup = `${sourceId}|${targetId}|${relation.toLowerCase()}`;
        if (seenEdges.has(dedup)) continue;
        seenEdges.add(dedup);
        insEdge.run(sourceId, targetId, relation, (edge.description ?? '').trim(), ref.sourceType, ref.sourceId);
      }

      for (const mention of graph.mentions) {
        const nodeId = idFor(mention.node);
        if (nodeId === null || !Number.isInteger(mention.chunkIndex) || mention.chunkIndex < 0) continue;
        insMention.run(nodeId, ref.sourceType, ref.sourceId, mention.chunkIndex);
      }

      this.pruneOrphanNodes();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Nodes mentioned in any of the given chunks (seed lookup for graph retrieval). */
  nodesMentionedIn(refs: ChunkRef[]): StoredGraphNode[] {
    const out = new Map<number, StoredGraphNode>();
    const stmt = this.db.prepare(
      `SELECT n.id, n.name, n.type, n.description
       FROM graph_mentions m JOIN graph_nodes n ON n.id = m.node_id
       WHERE m.source_type = ? AND m.source_id = ? AND m.chunk_index = ?`,
    );
    for (const ref of refs) {
      for (const raw of stmt.all(ref.sourceType, ref.sourceId, ref.chunkIndex)) {
        const row = raw as { id: number; name: string; type: string; description: string };
        out.set(Number(row.id), { ...row, id: Number(row.id) });
      }
    }
    return [...out.values()];
  }

  /** Nodes whose accumulated description grew past `minChars` — candidates for
   *  the ingest-time summarize pass. Longest first, bounded by `limit`. */
  nodesWithLongDescriptions(minChars: number, limit: number): StoredGraphNode[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, type, description FROM graph_nodes
         WHERE length(description) > ?
         ORDER BY length(description) DESC
         LIMIT ?`,
      )
      .all(minChars, limit) as Array<{ id: number; name: string; type: string; description: string }>;
    return rows.map((row) => ({ ...row, id: Number(row.id) }));
  }

  /** Overwrite one node's description (with the summarize pass result). */
  setNodeDescription(nodeId: number, description: string): void {
    this.db.prepare(`UPDATE graph_nodes SET description = ? WHERE id = ?`).run(description.trim(), nodeId);
  }

  /** All edges touching any of the given nodes, with node names joined in. */
  edgesTouching(nodeIds: number[]): StoredGraphEdge[] {
    if (nodeIds.length === 0) return [];
    const marks = nodeIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT e.source_node, e.target_node, e.relation, e.description,
                a.name AS source_name, b.name AS target_name
         FROM graph_edges e
         JOIN graph_nodes a ON a.id = e.source_node
         JOIN graph_nodes b ON b.id = e.target_node
         WHERE e.source_node IN (${marks}) OR e.target_node IN (${marks})`,
      )
      .all(...nodeIds, ...nodeIds) as Array<{
      source_node: number;
      target_node: number;
      relation: string;
      description: string;
      source_name: string;
      target_name: string;
    }>;
    return rows.map((r) => ({
      sourceNodeId: Number(r.source_node),
      targetNodeId: Number(r.target_node),
      sourceName: r.source_name,
      targetName: r.target_name,
      relation: r.relation,
      description: r.description,
    }));
  }

  getNodes(nodeIds: number[]): StoredGraphNode[] {
    if (nodeIds.length === 0) return [];
    const marks = nodeIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT id, name, type, description FROM graph_nodes WHERE id IN (${marks})`)
      .all(...nodeIds) as Array<{ id: number; name: string; type: string; description: string }>;
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  /** Chunk refs mentioning any of the given nodes. */
  mentionRefs(nodeIds: number[]): ChunkRef[] {
    if (nodeIds.length === 0) return [];
    const marks = nodeIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT DISTINCT source_type, source_id, chunk_index
         FROM graph_mentions WHERE node_id IN (${marks})`,
      )
      .all(...nodeIds) as Array<{ source_type: string; source_id: string; chunk_index: number }>;
    return rows.map((r) => ({
      sourceType: r.source_type,
      sourceId: r.source_id,
      chunkIndex: Number(r.chunk_index),
    }));
  }

  /** Fetch full chunk rows (embedding included) by ref; missing refs are skipped. */
  getChunks(refs: ChunkRef[]): StoredChunk[] {
    const stmt = this.db.prepare(
      `SELECT text, metadata_json, embedding FROM chunks
       WHERE source_type = ? AND source_id = ? AND chunk_index = ?`,
    );
    const out: StoredChunk[] = [];
    for (const ref of refs) {
      const row = stmt.get(ref.sourceType, ref.sourceId, ref.chunkIndex) as
        | { text: string; metadata_json: string; embedding: Uint8Array }
        | undefined;
      if (!row) continue;
      out.push({
        ...ref,
        text: row.text,
        metadata: safeParseObject(row.metadata_json),
        embedding: bufferToFloat32(row.embedding),
      });
    }
    return out;
  }

  /** Append one activity-log entry (audit trail: who did what, when). */
  appendLog(event: KnowledgeLogEvent, actor: KnowledgeLogActor, detail: Record<string, unknown> = {}): void {
    this.db
      .prepare(`INSERT INTO activity_log(at, event, actor, detail_json) VALUES(?, ?, ?, ?)`)
      .run(new Date().toISOString(), event, actor, JSON.stringify(detail));
  }

  /** Newest-first activity entries. */
  listLog(limit = 50): KnowledgeLogEntry[] {
    const rows = this.db
      .prepare(`SELECT id, at, event, actor, detail_json FROM activity_log ORDER BY id DESC LIMIT ?`)
      .all(Math.max(1, Math.min(500, Math.floor(limit)))) as Array<{
      id: number;
      at: string;
      event: string;
      actor: string;
      detail_json: string;
    }>;
    return rows.map((r) => ({
      id: Number(r.id),
      at: r.at,
      event: r.event as KnowledgeLogEvent,
      actor: r.actor as KnowledgeLogActor,
      detail: safeParseObject(r.detail_json),
    }));
  }

  private deleteSourceGraphRows(sourceType: string, sourceId: string): void {
    this.db.prepare(`DELETE FROM graph_edges WHERE source_type = ? AND source_id = ?`).run(sourceType, sourceId);
    this.db.prepare(`DELETE FROM graph_mentions WHERE source_type = ? AND source_id = ?`).run(sourceType, sourceId);
  }

  /** Drop nodes no mention or edge references anymore. Caller owns the transaction. */
  private pruneOrphanNodes(): void {
    this.db.exec(
      `DELETE FROM graph_nodes WHERE
         id NOT IN (SELECT node_id FROM graph_mentions)
         AND id NOT IN (SELECT source_node FROM graph_edges)
         AND id NOT IN (SELECT target_node FROM graph_edges)`,
    );
  }

  /**
   * Brute-force cosine top-k. `queryVec` must be L2-normalized (so the dot
   * product equals cosine similarity against the normalized stored vectors).
   */
  queryTopK(queryVec: Float32Array, k: number): StoredChunkHit[] {
    if (k <= 0) return [];
    const hits: StoredChunkHit[] = [];
    const stmt = this.db.prepare(
      `SELECT source_type, source_id, chunk_index, text, metadata_json, embedding FROM chunks`,
    );
    for (const raw of stmt.iterate()) {
      const row = raw as {
        source_type: string;
        source_id: string;
        chunk_index: number;
        text: string;
        metadata_json: string;
        embedding: Uint8Array;
      };
      hits.push({
        sourceType: row.source_type,
        sourceId: row.source_id,
        chunkIndex: Number(row.chunk_index),
        text: row.text,
        metadata: safeParseObject(row.metadata_json),
        score: dot(queryVec, bufferToFloat32(row.embedding)),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}
