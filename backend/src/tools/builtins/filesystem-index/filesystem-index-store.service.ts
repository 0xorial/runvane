import { Injectable } from '@nestjs/common';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export type IndexedPath = {
  path: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  kind: 'file' | 'directory';
};

@Injectable()
export class FilesystemIndexStore {
  private entries: IndexedPath[] = [];
  private indexedAt: string | null = null;

  getSnapshot(): { indexedAt: string | null; count: number; entries: IndexedPath[] } {
    return { indexedAt: this.indexedAt, count: this.entries.length, entries: this.entries.slice() };
  }

  async refresh(roots: string[]): Promise<{ indexedAt: string; count: number }> {
    const next: IndexedPath[] = [];
    for (const root of roots) {
      await this.walkRoot(path.resolve(root), root, next);
    }
    this.entries = next;
    this.indexedAt = new Date().toISOString();
    return { indexedAt: this.indexedAt, count: this.entries.length };
  }

  search(pattern: string, maxResults: number): IndexedPath[] {
    const needle = pattern.trim().toLowerCase();
    if (!needle) throw new Error('filesystem_index.search requires pattern');
    const hits: IndexedPath[] = [];
    for (const entry of this.entries) {
      if (!entry.relativePath.toLowerCase().includes(needle)) continue;
      hits.push(entry);
      if (hits.length >= maxResults) break;
    }
    return hits;
  }

  private async walkRoot(absRoot: string, displayRoot: string, out: IndexedPath[]): Promise<void> {
    const entries = await readdir(absRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absPath = path.join(absRoot, entry.name);
      const relativePath = path.relative(displayRoot, absPath) || entry.name;
      const entryStat = await stat(absPath);
      out.push({
        path: absPath,
        relativePath,
        size: entryStat.size,
        mtimeMs: entryStat.mtimeMs,
        kind: entryStat.isDirectory() ? 'directory' : 'file',
      });
      if (entry.isDirectory()) await this.walkRoot(absPath, displayRoot, out);
    }
  }
}
