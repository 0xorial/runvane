import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { bufferToFloat32, dot, float32ToBuffer, l2normalize } from '../vector.js';
import type { ChunkInput, StorageManifest, StoreCounts, StoredChunkHit } from './rag-store.types.js';

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
`;

function safeParseObject(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * One RAG storage backed by a single SQLite file (via Node's built-in
 * `node:sqlite`), fully separate from the app's Prisma DB. Embeddings are
 * stored L2-normalized, so similarity is a brute-force dot product at query
 * time. The class is intentionally narrow so a future ANN/sqlite-vec backend
 * can replace it behind the same surface.
 */
export class RagStore {
  private readonly db: DatabaseSync;

  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(SCHEMA);
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
    const row = this.db
      .prepare(`SELECT content_hash FROM sources WHERE source_type = ? AND source_id = ?`)
      .get(sourceType, sourceId) as { content_hash?: string } | undefined;
    return row?.content_hash ?? null;
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

  /** Drop a source item and all its chunks. */
  deleteSource(sourceType: string, sourceId: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`DELETE FROM chunks WHERE source_type = ? AND source_id = ?`).run(sourceType, sourceId);
      this.db.prepare(`DELETE FROM sources WHERE source_type = ? AND source_id = ?`).run(sourceType, sourceId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  counts(): StoreCounts {
    const chunks = this.db.prepare(`SELECT COUNT(*) AS n FROM chunks`).get() as { n: number };
    const sources = this.db.prepare(`SELECT COUNT(*) AS n FROM sources`).get() as { n: number };
    return { chunks: Number(chunks.n), sources: Number(sources.n) };
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
