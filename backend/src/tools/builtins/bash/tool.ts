import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { zerialize } from 'zodex';
import { bashParamsSchema, parseBashToolParams, type BashToolParams } from './params.js';
import { BashToolRulesSchema, parseBashToolRules, type BashToolRules } from './rules.js';

type BashToolResult = {
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  elapsed_ms: number;
};

function runBashCommand(
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
  maxOutputBytes: number,
  signal: AbortSignal,
  onProgress?: (delta: string) => void,
): Promise<BashToolResult> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', command], { cwd: cwd || undefined, signal });

    // Accumulate raw bytes (decode once at the end so multi-byte chars are not
    // corrupted at chunk boundaries); stream each kept slice live as it arrives.
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let keptBytes = 0; // combined stdout+stderr budget, matching maxOutputBytes
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    const absorb = (chunk: Buffer, sink: Buffer[]): void => {
      const remaining = maxOutputBytes - keptBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      if (chunk.length > remaining) truncated = true;
      sink.push(slice);
      keptBytes += slice.length;
      onProgress?.(slice.toString('utf8'));
    };

    child.stdout?.on('data', (chunk: Buffer) => absorb(chunk, outChunks));
    child.stderr?.on('data', (chunk: Buffer) => absorb(chunk, errChunks));

    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Steering / user cancellation → clean AbortError (no planner follow-up).
      if (error.code === 'ABORT_ERR' || error.name === 'AbortError' || signal.aborted) {
        reject(Object.assign(new Error('bash: command aborted'), { name: 'AbortError' }));
        return;
      }
      // Could not spawn the process (bad cwd, missing shell, …).
      reject(error);
    });

    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const elapsed_ms = Date.now() - start;
      const stdout = Buffer.concat(outChunks).toString('utf8');
      let stderr = Buffer.concat(errChunks).toString('utf8');
      if (timedOut) {
        stderr += `${stderr ? '\n' : ''}bash: command timed out after ${timeoutMs}ms`;
        resolve({ command, exit_code: -1, stdout, stderr, truncated, elapsed_ms });
        return;
      }
      // `code` is null when the child was killed by a signal → treat as failure.
      const exit_code = typeof code === 'number' ? code : 1;
      resolve({ command, exit_code, stdout, stderr, truncated, elapsed_ms });
    });
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

  getParamsSchema(): unknown {
    return bashParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(BashToolRulesSchema);
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

    return runBashCommand(params.command, cwd, timeoutMs, maxOutputBytes, context.signal, context.onProgress);
  }
}
