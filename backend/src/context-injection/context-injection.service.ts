import { Injectable, Logger } from '@nestjs/common';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentPreinjectConfig, PreinjectedFileRecord, PreinjectFileType } from '../contracts/preinject.js';

/** Per-file cap so one huge instruction file can't blow the planner's context budget. */
const MAX_FILE_BYTES = 20_000;

/** Traversal bounds: generous for monorepo instruction files, cheap on huge trees. */
const MAX_DEPTH = 5;
const MAX_CANDIDATES = 40;

/**
 * Directories never entered. Hidden directories are skipped too, except the
 * ones instruction conventions live in (`.github/copilot-instructions.md`,
 * `.cursor/rules/*.mdc`).
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  '__pycache__',
  'venv',
  'tmp',
]);
const HIDDEN_DIR_ALLOW = new Set(['.github', '.cursor']);

/** AI instruction files recognized at ANY depth (monorepos scope them per package). */
const INSTRUCTION_FILE_NAMES = new Set([
  'CLAUDE.md',
  'AGENTS.md',
  'AGENT.md',
  'GEMINI.md',
  '.cursorrules',
  '.clinerules',
  '.windsurfrules',
]);

type Candidate = { relPath: string; fileType: PreinjectFileType };

export type ContextInjectionResult = {
  files: PreinjectedFileRecord[];
  content: string;
  /** Per-file planner sections (`--- path ---\n<content>`) keyed by relPath,
   *  injected files only. `content` is these joined in discovery order; the
   *  preview endpoint uses them to show and price each file individually. */
  sections: Record<string, string>;
};

/**
 * Discovers AI-instruction context for a workspace and folds what the agent's
 * `preinject` config permits into a single content blob, ready to be persisted
 * as a `context-injection` chat entry and surfaced to the planner.
 *
 * Discovery is a bounded, deterministic traversal — NOT a flat root grab:
 * common AI instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules,
 * .clinerules, .windsurfrules, .github/copilot-instructions.md,
 * .cursor/rules/*.mdc) are picked up at any depth because monorepos scope
 * them per package, plus the root README as the one general-context file.
 * The scan root is the SANDBOX's workspace (see sandbox-scan-root.ts) —
 * callers must resolve it; there is deliberately no cwd default.
 *
 * Pure file I/O, no LLM call — this is why it isn't a `ThoughtTypeProvider`
 * (that abstraction is built around an LLM request/response cycle).
 */
@Injectable()
export class ContextInjectionService {
  private readonly logger = new Logger(ContextInjectionService.name);

  async scan(config: AgentPreinjectConfig | undefined, root: string): Promise<ContextInjectionResult | null> {
    const mode = config?.mode ?? 'none';
    if (mode === 'none') return null;
    const selectedTypes = mode === 'selected' ? new Set(config?.types ?? []) : null;

    return this.collect(root, await this.discover(root), (candidate) =>
      mode === 'all' ? true : selectedTypes!.has(candidate.fileType),
    );
  }

  /**
   * Explicit per-message selection (`overrides.contextFiles`): the user picked
   * exact candidate paths, so the agent's mode gating does not apply. Only
   * requested paths that discovery actually surfaced are read — the discovered
   * set is the whole API surface, never arbitrary disk. Unrequested candidates
   * don't appear in the result (no skipped-by-gating audit rows: there is no
   * gating), unreadable/binary requested ones are recorded as skipped.
   */
  async scanSelected(requestedPaths: string[], root: string): Promise<ContextInjectionResult | null> {
    const requested = new Set(requestedPaths);
    const candidates = (await this.discover(root)).filter((c) => requested.has(c.relPath));
    return this.collect(root, candidates, () => true);
  }

  /**
   * Bounded BFS for candidate files. Deterministic: directory entries are
   * visited in name order, results carry breadth-first (shallowest-first)
   * order, and the candidate count is capped.
   */
  private async discover(root: string): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs: root, rel: '', depth: 0 }];

    while (queue.length > 0 && out.length < MAX_CANDIDATES) {
      const dir = queue.shift()!;
      let entries;
      try {
        entries = await readdir(dir.abs, { withFileTypes: true });
      } catch {
        continue; // unreadable dir — skip, never fail the scan
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (out.length >= MAX_CANDIDATES) break;
        const rel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (dir.depth >= MAX_DEPTH) continue;
          if (SKIP_DIRS.has(entry.name)) continue;
          if (entry.name.startsWith('.') && !HIDDEN_DIR_ALLOW.has(entry.name)) continue;
          queue.push({ abs: path.join(dir.abs, entry.name), rel, depth: dir.depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;

        if (INSTRUCTION_FILE_NAMES.has(entry.name)) {
          out.push({ relPath: rel, fileType: 'instructions' });
        } else if (entry.name === 'copilot-instructions.md' && path.basename(dir.rel) === '.github') {
          out.push({ relPath: rel, fileType: 'instructions' });
        } else if (entry.name.endsWith('.mdc') && /(^|\/)\.cursor\/rules$/.test(dir.rel)) {
          out.push({ relPath: rel, fileType: 'instructions' });
        } else if (entry.name === 'README.md' && dir.depth === 0) {
          out.push({ relPath: rel, fileType: 'readme' });
        }
      }
    }
    return out;
  }

  private async collect(
    root: string,
    candidates: Candidate[],
    typeEnabled: (candidate: Candidate) => boolean,
  ): Promise<ContextInjectionResult | null> {
    const files: PreinjectedFileRecord[] = [];
    const sections: Record<string, string> = {};
    for (const candidate of candidates) {
      if (!typeEnabled(candidate)) {
        files.push({ path: candidate.relPath, fileType: candidate.fileType, status: 'skipped' });
        continue;
      }
      const content = await this.readAsText(path.join(root, candidate.relPath));
      if (content === null) {
        files.push({ path: candidate.relPath, fileType: candidate.fileType, status: 'skipped' });
        continue;
      }
      files.push({ path: candidate.relPath, fileType: candidate.fileType, status: 'injected' });
      sections[candidate.relPath] = `--- ${candidate.relPath} ---\n${content}`;
    }

    if (files.length === 0) return null;
    return { files, content: Object.values(sections).join('\n\n'), sections };
  }

  private async readAsText(absPath: string): Promise<string | null> {
    try {
      const s = await stat(absPath);
      if (!s.isFile()) return null;
      const buf = await readFile(absPath);
      if (buf.includes(0)) return null; // binary — skip
      const truncated = buf.length > MAX_FILE_BYTES;
      const text = (truncated ? buf.subarray(0, MAX_FILE_BYTES) : buf).toString('utf8');
      return truncated ? `${text}\n…(truncated)` : text;
    } catch (err) {
      this.logger.warn(`preinject: failed to read ${absPath}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
