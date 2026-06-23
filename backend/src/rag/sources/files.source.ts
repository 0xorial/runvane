import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { EntitySource, SourceItem } from './entity-source.js';

/** Same text-candidate policy as the legacy rag_search / filesystem tools. */
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.sql',
  '.css', '.html', '.yaml', '.yml',
]);

const DEFAULT_MAX_FILE_BYTES = 200_000;

function isTextCandidate(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return ext === '';
}

type FilesParams = { roots: string[]; maxFileBytes: number };

function parseParams(raw: Record<string, unknown>): FilesParams {
  const roots = Array.isArray(raw.roots)
    ? raw.roots.map((r) => String(r)).filter((r) => r.trim().length > 0)
    : [];
  if (roots.length === 0) throw new Error('files source: no roots configured');
  const maxFileBytes =
    typeof raw.maxFileBytes === 'number' && Number.isFinite(raw.maxFileBytes) && raw.maxFileBytes > 0
      ? Math.floor(raw.maxFileBytes)
      : DEFAULT_MAX_FILE_BYTES;
  return { roots, maxFileBytes };
}

async function safeRealpath(p: string): Promise<string> {
  const resolved = path.resolve(p);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

/** Indexes text files under configured roots; sourceId is the absolute path. */
@Injectable()
export class FilesEntitySource implements EntitySource {
  readonly type = 'files';
  readonly label = 'Files';

  async *enumerate(rawParams: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<SourceItem> {
    const params = parseParams(rawParams);
    const seen = new Set<string>();
    for (const root of params.roots) {
      const resolvedRoot = await safeRealpath(root);
      yield* this.walk(resolvedRoot, resolvedRoot, params, seen, signal);
    }
  }

  private async *walk(
    absDir: string,
    displayRoot: string,
    params: FilesParams,
    seen: Set<string>,
    signal?: AbortSignal,
  ): AsyncIterable<SourceItem> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        yield* this.walk(abs, displayRoot, params, seen, signal);
        continue;
      }
      if (!entry.isFile() || !isTextCandidate(abs) || seen.has(abs)) continue;

      let fileStat;
      try {
        fileStat = await stat(abs);
      } catch {
        continue;
      }
      if (fileStat.size > params.maxFileBytes) continue;

      let content: string;
      try {
        content = await readFile(abs, 'utf8');
      } catch {
        continue;
      }
      if (content.trim().length === 0) continue;

      seen.add(abs);
      yield {
        sourceId: abs,
        text: content,
        contentHash: createHash('sha1').update(content).digest('hex'),
        metadata: {
          path: abs,
          relativePath: path.relative(displayRoot, abs) || entry.name,
          ext: path.extname(abs).toLowerCase(),
          bytes: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        },
      };
    }
  }
}
