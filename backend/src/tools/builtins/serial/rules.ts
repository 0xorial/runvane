import { z } from 'zod';

export type SerialToolRules = {
  allowed: 'always' | 'never' | 'ask';
  socket_path: string;
  login_username?: string;
  login_password?: string;
  prompt_pattern: string;
  max_timeout_ms: number;
  max_output_bytes: number;
};

const SerialToolRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('ask'),
    socket_path: z.string().default(''),
    login_username: z.string().optional(),
    login_password: z.string().optional(),
    prompt_pattern: z.string().default('[$#]\\s*$'),
    max_timeout_ms: z.number().finite().int().min(100).default(120000),
    max_output_bytes: z.number().finite().int().min(256).default(200000),
  })
  .strict();

export function serialRulesSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      allowed: {
        type: 'string',
        enum: ['always', 'never', 'ask'],
        default: 'ask',
        description: 'Permission behavior for this tool.',
      },
      socket_path: {
        type: 'string',
        default: '',
        description:
          'Connection address for the VM serial port. ' +
          'Use "tcp://host:port" for UTM TCP Server Connection mode (e.g. "tcp://127.0.0.1:4444"), ' +
          'or a Unix socket path for socket-based connections (e.g. "/tmp/kali.sock").',
      },
      login_username: {
        type: 'string',
        description: 'Auto-login username for the VM console.',
      },
      login_password: {
        type: 'string',
        description: 'Auto-login password for the VM console.',
      },
      prompt_pattern: {
        type: 'string',
        default: '[$#]\\s*$',
        description: 'Regex pattern to detect the shell prompt.',
      },
      max_timeout_ms: {
        type: 'integer',
        minimum: 100,
        default: 120000,
        description: 'Maximum allowed timeout per command in milliseconds.',
      },
      max_output_bytes: {
        type: 'integer',
        minimum: 256,
        default: 200000,
        description: 'Maximum output bytes captured per command.',
      },
    },
    required: ['allowed'],
  };
}

export function parseSerialToolRules(raw: unknown): SerialToolRules {
  const parsed = SerialToolRulesSchema.parse(raw);
  const out: SerialToolRules = {
    allowed: parsed.allowed,
    socket_path: parsed.socket_path,
    prompt_pattern: parsed.prompt_pattern,
    max_timeout_ms: parsed.max_timeout_ms,
    max_output_bytes: parsed.max_output_bytes,
  };
  if (typeof parsed.login_username === 'string') out.login_username = parsed.login_username;
  if (typeof parsed.login_password === 'string') out.login_password = parsed.login_password;
  return out;
}
