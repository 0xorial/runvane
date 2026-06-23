// RAG API calls. Reuses the shared fetch helpers from client.ts (no edits to
// that file) so this stays isolated from the rest of the API surface.
import { getJson, sendJson, deleteJson } from "./client";
import type { RagStorageInfo, RagQueryHit, IngestResult } from "../../../backend/src/rag/contracts/rag";

export type { RagStorageInfo, RagQueryHit, IngestResult } from "../../../backend/src/rag/contracts/rag";

export type EntitySourceInfo = { type: string; label: string };

export type CreateRagStorageInput = {
  name: string;
  entitySource: string;
  embeddingProviderId: string;
  embeddingModel: string;
  sourceParams: Record<string, unknown>;
  chunkSize?: number;
  chunkOverlap?: number;
};

export function getRagSources(): Promise<EntitySourceInfo[]> {
  return getJson("/api/rag/sources") as Promise<EntitySourceInfo[]>;
}

export function getRagStorages(): Promise<RagStorageInfo[]> {
  return getJson("/api/rag/storages") as Promise<RagStorageInfo[]>;
}

export function createRagStorage(input: CreateRagStorageInput): Promise<RagStorageInfo> {
  return sendJson("/api/rag/storages", "POST", input) as Promise<RagStorageInfo>;
}

export function deleteRagStorage(id: string): Promise<{ ok: boolean }> {
  return deleteJson(`/api/rag/storages/${encodeURIComponent(id)}`) as Promise<{ ok: boolean }>;
}

export function ingestRagStorage(id: string): Promise<IngestResult> {
  return sendJson(`/api/rag/storages/${encodeURIComponent(id)}/ingest`, "POST", {}) as Promise<IngestResult>;
}

export function queryRagStorage(id: string, query: string, topK = 8): Promise<RagQueryHit[]> {
  return sendJson(`/api/rag/storages/${encodeURIComponent(id)}/query`, "POST", { query, topK }) as Promise<RagQueryHit[]>;
}
