import { z } from 'zod';

/** Representations Steel's `/v1/scrape` can return (cheapest → rawest). */
export const WEB_BROWSE_FORMATS = ['markdown', 'readability', 'cleaned_html', 'html'] as const;

export const WebBrowseParamsSchema = z
  .object({
    url: z.string().min(1).describe('Absolute http(s) URL to open.'),
    format: z
      .enum(WEB_BROWSE_FORMATS)
      .default('markdown')
      .describe(
        'Representation to return. Start with markdown; escalate to cleaned_html/html only when you need the raw DOM.',
      ),
    includeLinks: z
      .boolean()
      .default(false)
      .describe('Also return the list of links found on the page.'),
  })
  .strict();

export type WebBrowseParams = z.infer<typeof WebBrowseParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function webBrowseParamsSchema(): unknown {
  return z.toJSONSchema(WebBrowseParamsSchema);
}

export function parseWebBrowseParams(raw: unknown): WebBrowseParams {
  return WebBrowseParamsSchema.parse(raw);
}
