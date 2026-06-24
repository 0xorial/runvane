import { Injectable } from '@nestjs/common';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolLocation,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { zerialize } from 'zodex';
import {
  filesystemIndexParamsSchema,
  parseFilesystemIndexParams,
  type FilesystemIndexParams,
} from './params.js';
import { FilesystemIndexRulesSchema, parseFilesystemIndexRules, type FilesystemIndexRules } from './rules.js';
import { FilesystemIndexStore } from './filesystem-index-store.service.js';

async function resolveRoots(allowedRoots: string[]): Promise<string[]> {
  if (allowedRoots.length === 0) throw new Error('filesystem_index: no allowed_roots configured');
  return Promise.all(
    allowedRoots.map(async (root) => {
      const resolved = path.resolve(root);
      try {
        return await realpath(resolved);
      } catch {
        return resolved;
      }
    }),
  );
}

@Injectable()
export class FilesystemIndexTool extends BaseTool<FilesystemIndexParams, FilesystemIndexRules> {
  getLocation(): ToolLocation {
    return 'runtime';
  }

  constructor(private readonly index: FilesystemIndexStore) {
    super();
  }

  getName(): string {
    return 'filesystem_index';
  }

  getAiDescription(): string {
    return (
      'Maintain and query a path index under allowed roots. refresh rescans; search finds paths by substring; stats returns index metadata.'
    );
  }

  getHumanDescription(): string {
    return 'Index and search filesystem paths under allowed roots.';
  }

  getParamsSchema(): unknown {
    return filesystemIndexParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(FilesystemIndexRulesSchema);
  }

  getDefaultRules(): FilesystemIndexRules {
    return { allowed: 'ask', allowed_roots: [process.cwd()], max_results: 100 };
  }

  parseParams(raw: unknown): FilesystemIndexParams {
    return parseFilesystemIndexParams(raw);
  }

  parseRules(raw: unknown): FilesystemIndexRules {
    return parseFilesystemIndexRules(raw);
  }

  evaluatePermission(context: ToolPermissionContext<FilesystemIndexRules>): RuleEvaluationResult[] {
    const allowedRule = context.agentToolConfig.rules.allowed;
    const permission = allowedRule === 'always' ? 'allow' : allowedRule === 'never' ? 'forbid' : 'ask_user';
    return [{ ruleName: 'allowed', permission, detail: `Rule allowed='${allowedRule}'.` }];
  }

  async runTool(params: FilesystemIndexParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseFilesystemIndexRules(context.toolRules ?? this.getDefaultRules());
    const roots = await resolveRoots(rules.allowed_roots);

    if (params.operation === 'refresh') {
      return this.index.refresh(roots);
    }
    if (params.operation === 'stats') {
      const snapshot = this.index.getSnapshot();
      return { indexedAt: snapshot.indexedAt, count: snapshot.count };
    }
    if (!params.pattern) throw new Error('filesystem_index.search requires pattern');
    const maxResults = Math.min(params.max_results ?? rules.max_results, rules.max_results);
    const hits = this.index.search(params.pattern, maxResults);
    return { pattern: params.pattern, hits, count: hits.length };
  }
}
