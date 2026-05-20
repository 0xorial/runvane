import { z } from 'zod';

export const SerialToolRulesSchema = z
  .object({
    allowed: z
      .enum(['always', 'never', 'ask'])
      .default('ask')
      .describe('Permission behavior for this tool.'),
    socket_path: z
      .string()
      .default('')
      .describe(
        'Connection address for the VM serial port. ' +
          'Use "tcp://host:port" for UTM TCP Server Connection mode (e.g. "tcp://127.0.0.1:4444"), ' +
          'or a Unix socket path for socket-based connections (e.g. "/tmp/kali.sock").',
      ),
    login_username: z.string().optional().describe('Auto-login username for the VM console.'),
    login_password: z.string().optional().describe('Auto-login password for the VM console.'),
    prompt_pattern: z
      .string()
      .default('[$#]\\s*$')
      .describe('Regex pattern to detect the shell prompt.'),
    max_timeout_ms: z
      .number()
      .finite()
      .int()
      .min(100)
      .default(120000)
      .describe('Maximum allowed timeout per command in milliseconds.'),
    max_output_bytes: z
      .number()
      .finite()
      .int()
      .min(256)
      .default(200000)
      .describe('Maximum output bytes captured per command.'),
  })
  .strict();

export type SerialToolRules = z.infer<typeof SerialToolRulesSchema>;

export function parseSerialToolRules(raw: unknown): SerialToolRules {
  return SerialToolRulesSchema.parse(raw);
}
