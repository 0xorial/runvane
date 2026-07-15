// knowledge API calls. Reuses the shared fetch helpers from client.ts (no edits to
// that file) so this stays isolated from the rest of the API surface.
import { getJson, sendJson, deleteJson } from "./client";
import type {
  KnowledgeLogEntry,
  KnowledgeStorageInfo,
  KnowledgeQueryHit,
  KnowledgeRetrieveResult,
  RetrievePreviewResult,
  IngestResult,
  StorageGraphConfig,
} from "../../../backend/src/knowledge/contracts/knowledge";

export type {
  KnowledgeLogEntry,
  KnowledgeStorageInfo,
  KnowledgeQueryHit,
  KnowledgeGraphContext,
  KnowledgeRetrieveResult,
  RetrievePreviewResult,
  IngestResult,
  StorageGraphConfig,
} from "../../../backend/src/knowledge/contracts/knowledge";

export type EntitySourceInfo = { type: string; label: string };
export type GraphBuilderInfo = { type: string; label: string };

export type CreateKnowledgeStorageInput = {
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

export function getKnowledgeSources(): Promise<EntitySourceInfo[]> {
  return getJson("/api/knowledge/sources") as Promise<EntitySourceInfo[]>;
}

export function getKnowledgeGraphBuilders(): Promise<GraphBuilderInfo[]> {
  return getJson("/api/knowledge/graph-builders") as Promise<GraphBuilderInfo[]>;
}

export function getKnowledgeStorages(): Promise<KnowledgeStorageInfo[]> {
  return getJson("/api/knowledge/storages") as Promise<KnowledgeStorageInfo[]>;
}

export function createKnowledgeStorage(input: CreateKnowledgeStorageInput): Promise<KnowledgeStorageInfo> {
  return sendJson("/api/knowledge/storages", "POST", input) as Promise<KnowledgeStorageInfo>;
}

export function updateKnowledgeStorage(id: string, patch: { watch: boolean }): Promise<KnowledgeStorageInfo> {
  return sendJson(`/api/knowledge/storages/${encodeURIComponent(id)}`, "PATCH", patch) as Promise<KnowledgeStorageInfo>;
}

export function getKnowledgeStorageLog(id: string, limit = 50): Promise<{ entries: KnowledgeLogEntry[] }> {
  return getJson(`/api/knowledge/storages/${encodeURIComponent(id)}/log?limit=${limit}`) as Promise<{
    entries: KnowledgeLogEntry[];
  }>;
}

export function deleteKnowledgeStorage(id: string): Promise<{ ok: boolean }> {
  return deleteJson(`/api/knowledge/storages/${encodeURIComponent(id)}`) as Promise<{ ok: boolean }>;
}

export function ingestKnowledgeStorage(id: string): Promise<IngestResult> {
  return sendJson(`/api/knowledge/storages/${encodeURIComponent(id)}/ingest`, "POST", {}) as Promise<IngestResult>;
}

export function queryKnowledgeStorage(
  id: string,
  query: string,
  topK = 8,
  strategy: "simple" | "graph" = "simple",
): Promise<KnowledgeRetrieveResult> {
  return sendJson(`/api/knowledge/storages/${encodeURIComponent(id)}/query`, "POST", {
    query,
    topK,
    strategy,
  }) as Promise<KnowledgeRetrieveResult>;
}

/** Composer preview: same retrieval + planner-block token estimate a send
 *  with `overrides.knowledge` would produce. */
export function previewForcedRetrieval(input: {
  query: string;
  storages: string[];
  topK?: number;
}): Promise<RetrievePreviewResult> {
  return sendJson("/api/knowledge/retrieve/preview", "POST", input) as Promise<RetrievePreviewResult>;
}
