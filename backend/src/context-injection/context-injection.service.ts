import { Injectable, Logger } from '@nestjs/common';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentPreinjectConfig, PreinjectedFileRecord, PreinjectFileType } from '../contracts/preinject.js';

/** Per-file cap so one huge manifest can't blow the planner's context budget. */
const MAX_FILE_BYTES = 20_000;

type Candidate = { relPath: string; fileType: PreinjectFileType };

// Checked in this order, relative to the workspace root (same root the
// filesystem tool defaults its `allowed_roots` to: `process.cwd()`). Absent
// candidates are silently skipped — this is a "grab what's there" scan, not
// a hard requirement.
const CANDIDATES: readonly Candidate[] = [
  { relPath: 'CLAUDE.md', fileType: 'instructions' },
  { relPath: 'AGENTS.md', fileType: 'instructions' },
  { relPath: '.cursorrules', fileType: 'instructions' },
  { relPath: '.clinerules', fileType: 'instructions' },
  { relPath: '.windsurfrules', fileType: 'instructions' },
  { relPath: '.github/copilot-instructions.md', fileType: 'instructions' },
  { relPath: 'README.md', fileType: 'readme' },
  { relPath: 'package.json', fileType: 'manifest' },
  { relPath: 'pyproject.toml', fileType: 'manifest' },
  { relPath: 'Cargo.toml', fileType: 'manifest' },
  { relPath: 'go.mod', fileType: 'manifest' },
  { relPath: '.env.example', fileType: 'env_example' },
  { relPath: '.eslintrc', fileType: 'lint_config' },
  { relPath: '.eslintrc.json', fileType: 'lint_config' },
  { relPath: '.eslintrc.js', fileType: 'lint_config' },
  { relPath: '.prettierrc', fileType: 'lint_config' },
  { relPath: '.editorconfig', fileType: 'lint_config' },
];

export type ContextInjectionResult = {
  files: PreinjectedFileRecord[];
  content: string;
  /** Per-file planner sections (`--- path ---\n<content>`) keyed by relPath,
   *  injected files only. `content` is these joined in candidate order; the
   *  preview endpoint uses them to show and price each file individually. */
  sections: Record<string, string>;
};

/**
 * Scans a workspace root for well-known agent-context files (instructions,
 * manifests, readmes, lint configs, env-var samples) and folds the ones the
 * agent's `preinject` config permits into a single content blob, ready to be
 * persisted as a `context-injection` chat entry and surfaced to the planner.
 *
 * Pure file I/O, no LLM call — this is why it isn't a `ThoughtTypeProvider`
 * (that abstraction is built around an LLM request/response cycle).
 */
@Injectable()
export class ContextInjectionService {
  private readonly logger = new Logger(ContextInjectionService.name);

  async scan(
    config: AgentPreinjectConfig | undefined,
    root: string = process.cwd(),
  ): Promise<ContextInjectionResult | null> {
    const mode = config?.mode ?? 'none';
    if (mode === 'none') return null;
    const selectedTypes = mode === 'selected' ? new Set(config?.types ?? []) : null;

    const files: PreinjectedFileRecord[] = [];
    const sections: Record<string, string> = {};
    for (const candidate of CANDIDATES) {
      const absPath = path.join(root, candidate.relPath);
      const found = await this.statFile(absPath);
      if (!found) continue;

      const typeEnabled = mode === 'all' || selectedTypes!.has(candidate.fileType);
      if (!typeEnabled) {
        files.push({ path: candidate.relPath, fileType: candidate.fileType, status: 'skipped' });
        continue;
      }

      const content = await this.readAsText(absPath);
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

  private async statFile(absPath: string): Promise<boolean> {
    try {
      const s = await stat(absPath);
      return s.isFile();
    } catch {
      return false;
    }
  }

  private async readAsText(absPath: string): Promise<string | null> {
    try {
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
