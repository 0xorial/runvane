import { z } from 'zod';

export const WebSearchRulesSchema = z
  .object({
    endpoint: z
      .string()
      .min(1)
      .default(process.env.RUNVANE_WEB_SEARCH_ENDPOINT?.trim() || 'http://localhost:8080')
      .describe(
        'Base URL of the search service (SearXNG JSON API, e.g. the ai-browsing-enabler). Default overridable via RUNVANE_WEB_SEARCH_ENDPOINT.',
      ),
    maxResults: z
      .number()
      .finite()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Hard cap on the number of results returned.'),
    timeoutMs: z
      .number()
      .finite()
      .int()
      .min(100)
      .max(60000)
      .default(15000)
      .describe('Hard cap on the request timeout in milliseconds.'),
  })
  .strict();

export type WebSearchRules = z.infer<typeof WebSearchRulesSchema>;

export function parseWebSearchRules(raw: unknown): WebSearchRules {
  return WebSearchRulesSchema.parse(raw);
}
