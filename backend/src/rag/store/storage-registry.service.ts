import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RagStore } from './rag-store.js';
import type { StorageManifest } from './rag-store.types.js';
import type { RagStorageInfo } from '../contracts/rag.js';

/** DI token for the RAG data directory (one .sqlite file per storage). */
export const RAG_DATA_DIR = Symbol('RAG_DATA_DIR');

const SQLITE_EXT = '.sqlite';
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 150;

export type CreateStorageInput = {
  name: string;
  entitySource: string;
  embeddingProviderId: string;
  embeddingModel: string;
  sourceParams?: Record<string, unknown>;
  chunkSize?: number;
  chunkOverlap?: number;
  graph?: { builder: string; params: Record<string, unknown> } | null;
  watch?: boolean;
};

/**
 * Owns the directory of RAG storages. Each storage is a separate SQLite file
 * named `<id>.sqlite`; the registry creates/lists/opens/drops them and caches
 * open handles. Storages are deliberately decoupled from the app's Prisma DB
 * — this is the "separate part that builds the RAG database".
 */
@Injectable()
export class StorageRegistry implements OnModuleDestroy {
  private readonly dir: string;
  private readonly cache = new Map<string, RagStore>();

  constructor(@Optional() @Inject(RAG_DATA_DIR) dir?: string) {
    this.dir = dir ?? process.env.RAG_DATA_DIR ?? path.resolve(process.cwd(), '.rag');
    mkdirSync(this.dir, { recursive: true });
  }

  onModuleDestroy(): void {
    for (const store of this.cache.values()) store.close();
    this.cache.clear();
  }

  get dataDir(): string {
    return this.dir;
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}${SQLITE_EXT}`);
  }

  listIds(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(SQLITE_EXT))
      .map((f) => f.slice(0, -SQLITE_EXT.length));
  }

  /** Open (and cache) a storage by id, or null if its file is missing. */
  open(id: string): RagStore | null {
    const cached = this.cache.get(id);
    if (cached) return cached;
    if (!existsSync(this.fileFor(id))) return null;
    const store = new RagStore(this.fileFor(id));
    this.cache.set(id, store);
    return store;
  }

  create(input: CreateStorageInput): StorageManifest {
    const id = randomUUID();
    const store = new RagStore(this.fileFor(id));
    const manifest: StorageManifest = {
      id,
      name: input.name,
      entitySource: input.entitySource,
      embeddingProviderId: input.embeddingProviderId,
      embeddingModel: input.embeddingModel,
      embeddingDim: null,
      sourceParams: input.sourceParams ?? {},
      chunkSize: input.chunkSize ?? DEFAULT_CHUNK_SIZE,
      chunkOverlap: input.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP,
      graph: input.graph ?? null,
      watch: input.watch ?? false,
      createdAt: new Date().toISOString(),
      lastIngestedAt: null,
    };
    store.setManifest(manifest);
    this.cache.set(id, store);
    return manifest;
  }

  getManifest(id: string): StorageManifest | null {
    return this.open(id)?.getManifest() ?? null;
  }

  listManifests(): StorageManifest[] {
    const out: StorageManifest[] = [];
    for (const id of this.listIds()) {
      const manifest = this.open(id)?.getManifest();
      if (manifest) out.push(manifest);
    }
    return out;
  }

  /** Manifest + live chunk/source counts, for the config UI and tool. */
  info(id: string): RagStorageInfo | null {
    const store = this.open(id);
    const manifest = store?.getManifest();
    if (!store || !manifest) return null;
    // Older manifests may lack newer keys; normalize for the API.
    return {
      ...manifest,
      graph: manifest.graph ?? null,
      watch: manifest.watch ?? false,
      counts: store.counts(),
    };
  }

  listInfos(): RagStorageInfo[] {
    return this.listIds()
      .map((id) => this.info(id))
      .filter((x): x is RagStorageInfo => x !== null);
  }

  updateManifest(id: string, patch: Partial<StorageManifest>): StorageManifest | null {
    const store = this.open(id);
    const current = store?.getManifest();
    if (!store || !current) return null;
    const next: StorageManifest = { ...current, ...patch, id: current.id };
    store.setManifest(next);
    return next;
  }

  delete(id: string): boolean {
    const cached = this.cache.get(id);
    if (cached) {
      cached.close();
      this.cache.delete(id);
    }
    const file = this.fileFor(id);
    if (!existsSync(file)) return false;
    rmSync(file);
    // Remove any WAL/SHM sidecars too.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = file + suffix;
      if (existsSync(sidecar)) rmSync(sidecar);
    }
    return true;
  }
}
