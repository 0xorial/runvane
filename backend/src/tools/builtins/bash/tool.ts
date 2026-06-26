import { Injectable } from '@nestjs/common';
import { BaseTool, type ToolLocation, type ToolRunContext } from '../../base-tool.js';
import { zerialize } from 'zodex';
import { bashParamsSchema, parseBashToolParams, type BashToolParams } from './params.js';
import { BashToolRulesSchema, parseBashToolRules, type BashToolRules } from './rules.js';
import { runBashCommand, type BashToolResult } from './run-command.js';

@Injectable()
export class BashTool extends BaseTool<BashToolParams, BashToolRules> {
  getLocation(): ToolLocation {
    return 'target';
  }

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
      working_dir: '',
      max_timeout_ms: 60000,
      max_output_bytes: 20000,
    };
  }

  parseParams(raw: unknown): BashToolParams {
    return parseBashToolParams(raw);
  }

  parseRules(raw: unknown): BashToolRules {
    return parseBashToolRules(raw);
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
