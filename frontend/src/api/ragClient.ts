// RAG API calls. Reuses the shared fetch helpers from client.ts (no edits to
// that file) so this stays isolated from the rest of the API surface.
import { getJson, sendJson, deleteJson } from "./client";
import type {
  RagLogEntry,
  RagStorageInfo,
  RagQueryHit,
  RagRetrieveResult,
  RetrievePreviewResult,
  IngestResult,
  StorageGraphConfig,
} from "../../../backend/src/rag/contracts/rag";

export type {
  RagLogEntry,
  RagStorageInfo,
  RagQueryHit,
  RagGraphContext,
  RagRetrieveResult,
  RetrievePreviewResult,
  IngestResult,
  StorageGraphConfig,
} from "../../../backend/src/rag/contracts/rag";

export type EntitySourceInfo = { type: string; label: string };
export type GraphBuilderInfo = { type: string; label: string };

export type CreateRagStorageInput = {
  name: string;
  entitySource: string;
  embeddingProviderId: string;
  embeddingModel: string;
  sourceParams: Record<string, unknown>;
  chunkSize?: number;
  chunkOverlap?: number;
  graph?: StorageGraphConfig | null;
  watch?: boolean;
};

export function getRagSources(): Promise<EntitySourceInfo[]> {
  return getJson("/api/rag/sources") as Promise<EntitySourceInfo[]>;
}

export function getRagGraphBuilders(): Promise<GraphBuilderInfo[]> {
  return getJson("/api/rag/graph-builders") as Promise<GraphBuilderInfo[]>;
}

export function getRagStorages(): Promise<RagStorageInfo[]> {
  return getJson("/api/rag/storages") as Promise<RagStorageInfo[]>;
}

export function createRagStorage(input: CreateRagStorageInput): Promise<RagStorageInfo> {
  return sendJson("/api/rag/storages", "POST", input) as Promise<RagStorageInfo>;
}

export function updateRagStorage(id: string, patch: { watch: boolean }): Promise<RagStorageInfo> {
  return sendJson(`/api/rag/storages/${encodeURIComponent(id)}`, "PATCH", patch) as Promise<RagStorageInfo>;
}

export function getRagStorageLog(id: string, limit = 50): Promise<{ entries: RagLogEntry[] }> {
  return getJson(`/api/rag/storages/${encodeURIComponent(id)}/log?limit=${limit}`) as Promise<{
    entries: RagLogEntry[];
  }>;
}

export function deleteRagStorage(id: string): Promise<{ ok: boolean }> {
  return deleteJson(`/api/rag/storages/${encodeURIComponent(id)}`) as Promise<{ ok: boolean }>;
}

export function ingestRagStorage(id: string): Promise<IngestResult> {
  return sendJson(`/api/rag/storages/${encodeURIComponent(id)}/ingest`, "POST", {}) as Promise<IngestResult>;
}

export function queryRagStorage(
  id: string,
  query: string,
  topK = 8,
  strategy: "simple" | "graph" = "simple",
): Promise<RagRetrieveResult> {
  return sendJson(`/api/rag/storages/${encodeURIComponent(id)}/query`, "POST", {
    query,
    topK,
    strategy,
  }) as Promise<RagRetrieveResult>;
}

/** Composer preview: same retrieval + planner-block token estimate a send
 *  with `overrides.rag` would produce. */
export function previewForcedRetrieval(input: {
  query: string;
  storages: string[];
  topK?: number;
}): Promise<RetrievePreviewResult> {
  return sendJson("/api/rag/retrieve/preview", "POST", input) as Promise<RetrievePreviewResult>;
}
