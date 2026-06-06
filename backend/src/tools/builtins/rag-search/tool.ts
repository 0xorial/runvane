import { Injectable } from '@nestjs/common';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { zerialize } from 'zodex';
import { parseRagSearchParams, ragSearchParamsSchema, type RagSearchParams } from './params.js';
import { parseRagSearchRules, RagSearchRulesSchema, type RagSearchRules } from './rules.js';
import { ragSearchFiles } from './search.js';

async function resolveSearchRoots(allowedRoots: string[]): Promise<string[]> {
  if (allowedRoots.length === 0) throw new Error('rag_search: no allowed_roots configured');
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
export class RagSearchTool extends BaseTool<RagSearchParams, RagSearchRules> {
  getName(): string {
    return 'rag_search';
  }

  getAiDescription(): string {
    return (
      'Search text files under configured allowed roots for a query substring. ' +
      'Returns matching file paths, line numbers, and excerpts. Use before read_file when you do not know exact paths.'
    );
  }

  getHumanDescription(): string {
    return 'Search text files under allowed roots.';
  }

  getParamsSchema(): unknown {
    return ragSearchParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(RagSearchRulesSchema);
  }

  getDefaultRules(): RagSearchRules {
    return {
      allowed: 'ask',
      allowed_roots: [process.cwd()],
      max_results: 20,
      max_file_bytes: 200_000,
    };
  }

  parseParams(raw: unknown): RagSearchParams {
    return parseRagSearchParams(raw);
  }

  parseRules(raw: unknown): RagSearchRules {
    return parseRagSearchRules(raw);
  }

  evaluatePermission(context: ToolPermissionContext<RagSearchRules>): RuleEvaluationResult[] {
    const allowedRule = context.agentToolConfig.rules.allowed;
    const permission = allowedRule === 'always' ? 'allow' : allowedRule === 'never' ? 'forbid' : 'ask_user';
    return [{ ruleName: 'allowed', permission, detail: `Rule allowed='${allowedRule}'.` }];
  }

  async runTool(params: RagSearchParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseRagSearchRules(context.toolRules ?? this.getDefaultRules());
    const roots = await resolveSearchRoots(rules.allowed_roots);
    const maxResults = Math.min(params.max_results ?? rules.max_results, rules.max_results);
    const pathPrefix = params.path_prefix ? path.resolve(params.path_prefix) : null;
    const hits = await ragSearchFiles({
      query: params.query,
      roots,
      maxResults,
      maxFileBytes: rules.max_file_bytes,
      pathPrefix,
    });
    return { query: params.query, hits, count: hits.length };
  }
}
