import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { bashParamsSchema, parseBashToolParams, type BashToolParams } from './params.js';
import { bashRulesSchema, parseBashToolRules, type BashToolRules } from './rules.js';

type BashToolResult = {
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  elapsed_ms: number;
};

function execFileCapped(
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<BashToolResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    execFile(
      '/bin/bash',
      ['-c', command],
      {
        cwd: cwd || undefined,
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes * 2, // generous buffer; we cap manually below
        encoding: 'buffer',
      },
      (error, stdoutBuf, stderrBuf) => {
        const elapsed_ms = Date.now() - start;

        // Determine exit code
        let exit_code = 0;
        if (error) {
          if ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
            // execFile sets error.killed and error.signal on timeout
            resolve({
              command,
              exit_code: -1,
              stdout: '',
              stderr: `bash: command timed out after ${timeoutMs}ms`,
              truncated: false,
              elapsed_ms,
            });
            return;
          }
          exit_code = (error as { code?: number }).code ?? 1;
        }

        // Cap output
        const totalBuf = Buffer.concat([stdoutBuf, stderrBuf]);
        const truncated = totalBuf.length > maxOutputBytes;

        const stdoutBytes = Math.min(stdoutBuf.length, maxOutputBytes);
        const remainingBytes = Math.max(0, maxOutputBytes - stdoutBytes);
        const stderrBytes = Math.min(stderrBuf.length, remainingBytes);

        const stdout = stdoutBuf.slice(0, stdoutBytes).toString('utf8');
        const stderr = stderrBuf.slice(0, stderrBytes).toString('utf8');

        resolve({ command, exit_code, stdout, stderr, truncated, elapsed_ms });
      },
    );
  });
}

@Injectable()
export class BashTool extends BaseTool<BashToolParams, BashToolRules> {
  getName(): string {
    return 'bash';
  }

  getAiDescription(): string {
    return (
      'Run an arbitrary shell command on the host Mac via /bin/bash -c and return the result. ' +
      'The result includes stdout, stderr, the exit code, and whether output was truncated. ' +
      'Use this to read files, run scripts, check system state, or execute any CLI tool available on the machine. ' +
      'Exit code 0 means success; non-zero means failure; -1 means the command timed out.'
    );
  }

  getHumanDescription(): string {
    return 'Run a shell command on the host machine.';
  }

  getParamsSchema(): Record<string, unknown> {
    return bashParamsSchema();
  }

  getRulesSchema(): Record<string, unknown> {
    return bashRulesSchema();
  }

  getDefaultRules(): BashToolRules {
    return {
      allowed: 'ask',
      working_dir: '',
      max_timeout_ms: 60000,
      max_output_bytes: 100000,
    };
  }

  parseParams(raw: unknown): BashToolParams {
    return parseBashToolParams(raw);
  }

  parseRules(raw: unknown): BashToolRules {
    return parseBashToolRules(raw);
  }

  evaluatePermission(context: ToolPermissionContext<BashToolRules>): RuleEvaluationResult[] {
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

  async runTool(params: BashToolParams, context: ToolRunContext): Promise<BashToolResult> {
    const rules = parseBashToolRules(context.toolRules ?? this.getDefaultRules());

    const timeoutMs = params.timeout_ms !== undefined
      ? Math.min(params.timeout_ms, rules.max_timeout_ms)
      : rules.max_timeout_ms;

    const maxOutputBytes = params.max_output_bytes !== undefined
      ? Math.min(params.max_output_bytes, rules.max_output_bytes)
      : rules.max_output_bytes;

    const cwd = params.working_dir ?? (rules.working_dir || undefined);

    return execFileCapped(params.command, cwd, timeoutMs, maxOutputBytes);
  }
}
