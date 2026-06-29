import { z } from 'zod';

export const WebBrowseRulesSchema = z
  .object({
    endpoint: z
      .string()
      .min(1)
      .default(process.env.RUNVANE_WEB_BROWSE_ENDPOINT?.trim() || 'http://localhost:3000')
      .describe(
        'Base URL of the browse service (Steel API, e.g. the ai-browsing-enabler). Default overridable via RUNVANE_WEB_BROWSE_ENDPOINT.',
      ),
    proxyUrl: z
      .string()
      .default(process.env.RUNVANE_WEB_BROWSE_PROXY?.trim() ?? 'socks5://127.0.0.1:1080')
      .describe(
        'Proxy the headless browser egresses through (the exit-node SOCKS tunnel). Empty string disables it. Default overridable via RUNVANE_WEB_BROWSE_PROXY.',
      ),
    maxResponseBytes: z
      .number()
      .finite()
      .int()
      .min(256)
      .max(2_000_000)
      .default(200_000)
      .describe('Hard cap on returned content length (truncated beyond this).'),
    timeoutMs: z
      .number()
      .finite()
      .int()
      .min(1000)
      .max(120000)
      .default(60000)
      .describe('Hard cap on the request timeout in milliseconds (browser fetches can be slow).'),
  })
  .strict();

export type WebBrowseRules = z.infer<typeof WebBrowseRulesSchema>;

export function parseWebBrowseRules(raw: unknown): WebBrowseRules {
  return WebBrowseRulesSchema.parse(raw);
}
