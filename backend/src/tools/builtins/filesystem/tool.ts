import { Injectable } from '@nestjs/common';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolLocation,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { zerialize } from 'zodex';
import { filesystemParamsSchema, parseFilesystemToolParams, type FilesystemToolParams } from './params.js';
import { FilesystemToolRulesSchema, parseFilesystemToolRules, type FilesystemToolRules } from './rules.js';
import { resolveAllowedPath } from './path-access.js';

type ListDirEntry = {
  name: string;
  kind: 'file' | 'directory' | 'other';
};

type ReadFileResult = {
  operation: 'read_file';
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
};

type ListDirResult = {
  operation: 'list_dir';
  path: string;
  entries: ListDirEntry[];
  truncated: boolean;
};

@Injectable()
export class FilesystemTool extends BaseTool<FilesystemToolParams, FilesystemToolRules> {
  getLocation(): ToolLocation {
    return 'target';
  }

  getName(): string {
    return 'filesystem';
  }

  getAiDescription(): string {
    return (
      'Read files or list directories on the host filesystem within configured allowed roots. ' +
      'Use read_file for file contents and list_dir to inspect a folder. ' +
      'Paths outside allowed roots are rejected.'
    );
  }

  getHumanDescription(): string {
    return 'Read files and list directories within allowed roots.';
  }

  getParamsSchema(): unknown {
    return filesystemParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(FilesystemToolRulesSchema);
  }

  getDefaultRules(): FilesystemToolRules {
    return {
      allowed: 'ask',
      allowed_roots: [process.cwd()],
      max_read_bytes: 200_000,
      max_list_entries: 500,
    };
  }

  parseParams(raw: unknown): FilesystemToolParams {
    return parseFilesystemToolParams(raw);
  }

  parseRules(raw: unknown): FilesystemToolRules {
    return parseFilesystemToolRules(raw);
  }

  evaluatePermission(context: ToolPermissionContext<FilesystemToolRules>): RuleEvaluationResult[] {
    const allowedRule = context.agentToolConfig.rules.allowed;
    const permission = allowedRule === 'always' ? 'allow' : allowedRule === 'never' ? 'forbid' : 'ask_user';
    return [
      {
        ruleName: 'allowed',
        permission,
        detail: `Rule allowed='${allowedRule}'.`,
      },
    ];
  }

  async runTool(params: FilesystemToolParams, context: ToolRunContext): Promise<ReadFileResult | ListDirResult> {
    const rules = parseFilesystemToolRules(context.toolRules ?? this.getDefaultRules());
    const targetPath = await resolveAllowedPath(params.path, rules.allowed_roots);

    if (params.operation === 'read_file') {
      return this.readFile(targetPath, params, rules);
    }
    return this.listDir(targetPath, rules);
  }

  private async readFile(
    targetPath: string,
    params: FilesystemToolParams,
    rules: FilesystemToolRules,
  ): Promise<ReadFileResult> {
    const entryStat = await stat(targetPath);
    if (!entryStat.isFile()) {
      throw new Error(`filesystem: read_file requires a file path, got ${params.path}`);
    }

    const maxBytes = Math.min(params.max_bytes ?? rules.max_read_bytes, rules.max_read_bytes);
    const buf = await readFile(targetPath);
    const truncated = buf.length > maxBytes;
    const slice = truncated ? buf.subarray(0, maxBytes) : buf;

    return {
      operation: 'read_file',
      path: targetPath,
      content: slice.toString('utf8'),
      bytes: slice.length,
      truncated,
    };
  }

  private async listDir(targetPath: string, rules: FilesystemToolRules): Promise<ListDirResult> {
    const entryStat = await stat(targetPath);
    if (!entryStat.isDirectory()) {
      throw new Error(`filesystem: list_dir requires a directory path, got ${targetPath}`);
    }

    const names = await readdir(targetPath);
    const capped = names.slice(0, rules.max_list_entries);
    const entries: ListDirEntry[] = await Promise.all(
      capped.map(async (name) => {
        const childPath = path.join(targetPath, name);
        const childStat = await stat(childPath);
        const kind: ListDirEntry['kind'] = childStat.isDirectory()
          ? 'directory'
          : childStat.isFile()
            ? 'file'
            : 'other';
        return { name, kind };
      }),
    );

    return {
      operation: 'list_dir',
      path: targetPath,
      entries,
      truncated: names.length > rules.max_list_entries,
    };
  }
}
