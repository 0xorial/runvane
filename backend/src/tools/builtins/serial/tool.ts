import { Injectable } from '@nestjs/common';
import { BaseTool, type ToolRunContext } from '../../base-tool.js';
import { serialParamsSchema, parseSerialToolParams, type SerialToolParams } from './params.js';
import { zerialize } from 'zodex';
import { SerialToolRulesSchema, parseSerialToolRules, type SerialToolRules } from './rules.js';
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
      'Run shell commands on a persistent remote Kali Linux VM (UTM Virtio serial socket); ' +
      'session state — cwd, env, processes — persists across calls. Isolated VM, so destructive/CTF work is safe. ' +
      'Requires the socket_path rule.'
    );
  }

  getHumanDescription(): string {
    return 'Execute a command on a remote Kali Linux VM via a serial socket.';
  }

  getParamsSchema(): unknown {
    return serialParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(SerialToolRulesSchema);
  }

  getDefaultRules(): SerialToolRules {
    return {
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
    const result = await conn.run(params.command, timeoutMs, rules.max_output_bytes, context.signal, context.onProgress);

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
