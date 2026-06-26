import { z } from 'zod';

const HostListSchema = z.array(z.string().min(1));
const DEFAULT_BLOCKED = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '169.254.169.254'];

export const CurlToolRulesSchema = z
  .object({
    allowHttp: z.boolean().default(false).describe('Allow plain HTTP (otherwise HTTPS only).'),
    allowedHosts: HostListSchema.default([]).describe(
      'Optional allowlist. Empty means no allowlist check. Supports exact host or *.example.com.',
    ),
    blockedHosts: HostListSchema.default(DEFAULT_BLOCKED).describe(
      'Blocklist of hosts. Supports exact host or *.example.com.',
    ),
    maxTimeoutMs: z
      .number()
      .finite()
      .int()
      .min(100)
      .max(60000)
      .default(10000)
      .describe('Hard cap on the request timeout in milliseconds.'),
    maxResponseBytes: z
      .number()
      .finite()
      .int()
      .min(256)
      .max(1000000)
      .default(50000)
      .describe('Hard cap on response bytes returned.'),
  })
  .strict();

export type CurlToolRules = z.infer<typeof CurlToolRulesSchema>;

export function parseCurlToolRules(raw: unknown): CurlToolRules {
  const parsed = CurlToolRulesSchema.parse(raw);
  // Normalise host lists to lower-case for case-insensitive matching.
  parsed.allowedHosts = parsed.allowedHosts.map((h) => h.toLowerCase());
  parsed.blockedHosts = parsed.blockedHosts.map((h) => h.toLowerCase());
  return parsed;
}
