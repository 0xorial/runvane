import { readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Heuristic exploration behind "suggest roots": walk a base directory
 * breadth-first and rank subdirectories by how much indexable text they hold,
 * so the UI (optionally refined by an LLM pass) can offer storage roots
 * instead of making the user hand-pick paths that fit the indexer's rules.
 */

/** Same text-candidate policy as the files entity source. */
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.sql',
  '.css', '.html', '.yaml', '.yml',
]);

/** Directories that are never sensible storage roots. */
const DENYLIST = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target',
  'tmp', 'temp', 'cache', '__pycache__', 'venv', 'test-results',
]);

const MAX_DEPTH = 4;
const MAX_ENTRIES = 20_000;
const MAX_CANDIDATES = 12;
const MAX_SAMPLES = 5;

export type RootCandidate = {
  /** Absolute path of the candidate directory. */
  path: string;
  /** Path relative to the scanned base ('' for the base itself). */
  relative: string;
  /** Indexable text files in this directory's subtree (after pruning). */
  files: number;
  /** A few example filenames (relative to the candidate). */
  samples: string[];
};

function isTextCandidate(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

type DirNode = { abs: string; rel: string; depth: number; files: number; samples: string[] };

/**
 * Scan the tree once, then report candidates: directories at depth ≤ 2 with
 * their subtree counts, ranked by file count. The base itself is included
 * (as relative '') only when files live directly in it, so "index the whole
 * base" stays available without recommending a monorepo root by default.
 */
export async function scanRootCandidates(base: string): Promise<RootCandidate[]> {
  const absBase = path.resolve(base);
  const nodes = new Map<string, DirNode>();
  let visited = 0;

  const walk = async (abs: string, rel: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || visited >= MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    const node: DirNode = { abs, rel, depth, files: 0, samples: [] };
    nodes.set(rel, node);
    for (const entry of entries) {
      if (visited >= MAX_ENTRIES) break;
      visited += 1;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (DENYLIST.has(entry.name.toLowerCase())) continue;
        await walk(path.join(abs, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depth + 1);
      } else if (entry.isFile() && isTextCandidate(entry.name)) {
        node.files += 1;
        if (node.samples.length < MAX_SAMPLES) node.samples.push(entry.name);
      }
    }
  };
  await walk(absBase, '', 0);

  // Subtree totals: every node's own files roll up into ancestors ≤ depth 2.
  const totals = new Map<string, { files: number; samples: string[] }>();
  for (const node of nodes.values()) {
    let rel = node.rel;
    for (;;) {
      const holder = nodes.get(rel);
      if (holder && holder.depth <= 2) {
        const t = totals.get(rel) ?? { files: 0, samples: [] };
        t.files += node.files;
        for (const s of node.samples) {
          if (t.samples.length >= MAX_SAMPLES) break;
          t.samples.push(node.rel === rel ? s : `${node.rel.slice(rel ? rel.length + 1 : 0)}/${s}`);
        }
        totals.set(rel, t);
      }
      if (!rel) break;
      const cut = rel.lastIndexOf('/');
      rel = cut === -1 ? '' : rel.slice(0, cut);
    }
  }

  const out: RootCandidate[] = [];
  for (const [rel, t] of totals) {
    if (t.files === 0) continue;
    // The base only counts its DIRECT files (its subtree equals everything).
    const files = rel === '' ? (nodes.get('')?.files ?? 0) : t.files;
    const samples = rel === '' ? (nodes.get('')?.samples ?? []) : t.samples;
    if (files === 0) continue;
    // Skip depth-2 dirs whose parent already tells the same story (>80% of it).
    if (rel.includes('/')) {
      const parent = rel.slice(0, rel.lastIndexOf('/'));
      const parentFiles = totals.get(parent)?.files ?? 0;
      if (parentFiles > 0 && files / parentFiles > 0.8) continue;
    }
    out.push({ path: rel ? path.join(absBase, rel) : absBase, relative: rel, files, samples });
  }
  out.sort((a, b) => b.files - a.files);
  return out.slice(0, MAX_CANDIDATES);
}
