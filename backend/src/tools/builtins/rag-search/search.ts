import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type RagSearchHit = {
  path: string;
  line: number;
  excerpt: string;
};

type SearchOptions = {
  query: string;
  roots: string[];
  maxResults: number;
  maxFileBytes: number;
  pathPrefix: string | null;
};

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.sql', '.css', '.html', '.yaml', '.yml',
]);

function isTextCandidate(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return !ext;
}

async function walkFiles(root: string, out: string[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, out);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
}

export async function ragSearchFiles(options: SearchOptions): Promise<RagSearchHit[]> {
  const query = options.query.trim().toLowerCase();
  if (!query) throw new Error('rag_search: query is required');

  const hits: RagSearchHit[] = [];
  for (const root of options.roots) {
    const files: string[] = [];
    await walkFiles(root, files);
    for (const filePath of files) {
      if (options.pathPrefix && !filePath.startsWith(options.pathPrefix)) continue;
      if (!isTextCandidate(filePath)) continue;
      const fileStat = await stat(filePath);
      if (fileStat.size > options.maxFileBytes) continue;

      const content = await readFile(filePath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i]!.toLowerCase().includes(query)) continue;
        hits.push({
          path: filePath,
          line: i + 1,
          excerpt: lines[i]!.trim().slice(0, 240),
        });
        if (hits.length >= options.maxResults) return hits;
      }
    }
  }
  return hits;
}
