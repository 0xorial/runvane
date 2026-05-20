import { Injectable } from '@nestjs/common';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { serialParamsSchema, parseSerialToolParams, type SerialToolParams } from './params.js';
import { serialRulesSchema, parseSerialToolRules, type SerialToolRules } from './rules.js';
import { SerialConnectionManager } from './connection.js';

@Injectable()
export class SerialTerminalTool extends BaseTool<SerialToolParams, SerialToolRules> {
  constructor(private readonly manager: SerialConnectionManager) {
    super();
  }

  getName(): string {
    return 'serial_terminal';
  }

  getAiDescription(): string {
    return (
      'Run shell commands on a remote Kali Linux VM via a UTM Virtio Serial Unix socket connection. ' +
      'The shell session persists across calls — environment variables, working directory, and process state are retained. ' +
      'Well-suited for CTF work: destructive commands are safe (it is an isolated VM), and the full Kali tool suite is available. ' +
      'Returns stdout/stderr output, exit code, and elapsed time. ' +
      'The socket_path rule must be configured before use.'
    );
  }

  getHumanDescription(): string {
    return 'Execute a command on a remote Kali Linux VM via a serial socket.';
  }

  getParamsSchema(): Record<string, unknown> {
    return serialParamsSchema();
  }

  getRulesSchema(): Record<string, unknown> {
    return serialRulesSchema();
  }

  getDefaultRules(): SerialToolRules {
    return {
      allowed: 'ask',
      socket_path: '',
      prompt_pattern: '[$#]\\s*$',
      max_timeout_ms: 120000,
      max_output_bytes: 200000,
    };
  }

  parseParams(raw: unknown): SerialToolParams {
    return parseSerialToolParams(raw);
  }

  parseRules(raw: unknown): SerialToolRules {
    return parseSerialToolRules(raw);
  }

  evaluatePermission(context: ToolPermissionContext<SerialToolRules>): RuleEvaluationResult[] {
    const allowedRule = context.agentToolConfig.rules.allowed;
    const permission =
      allowedRule === 'always' ? 'allow' : allowedRule === 'never' ? 'forbid' : 'ask_user';
    return [
      {
        ruleName: 'allowed',
        permission,
        detail: `Rule allowed='${allowedRule}'.`,
      },
    ];
  }

  async runTool(params: SerialToolParams, context: ToolRunContext): Promise<unknown> {
    const start = Date.now();
    const rules = parseSerialToolRules(context.toolRules ?? this.getDefaultRules());

    if (!rules.socket_path) {
      throw new Error(
        'serial_terminal: socket_path is not configured. Set the socket_path rule to the UTM Virtio Serial Unix socket path.',
      );
    }

    const timeoutMs = Math.min(
      params.timeout_ms ?? rules.max_timeout_ms,
      rules.max_timeout_ms,
    );

    const conn = this.manager.getOrCreate(rules.socket_path, rules);
    // run() serialises concurrent calls, (re)connects, and retries once.
    const result = await conn.run(params.command, timeoutMs, rules.max_output_bytes);

    return {
      command: params.command,
      exit_code: result.exitCode,
      output: result.stdout,
      truncated: result.truncated,
      elapsed_ms: Date.now() - start,
      socket_path: rules.socket_path,
    };
  }
}
