import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import { BaseTool, type ToolPolicy, type ToolRunContext } from '../../base-tool.js';
import { parseWebBrowseParams, webBrowseParamsSchema, type WebBrowseParams } from './params.js';
import { WebBrowseRulesSchema, parseWebBrowseRules, type WebBrowseRules } from './rules.js';

/** Shape of Steel's `/v1/scrape` response (only the fields we surface). */
type ScrapeResponse = {
  content?: Record<string, string>;
  metadata?: { statusCode?: number; title?: string; wordCount?: number };
  links?: Array<{ url?: string; text?: string }>;
  // error shape (non-2xx)
  message?: string;
  error?: string;
};

/**
 * Harness tool: fetch a page through a headless browser (Steel) and return its
 * content. The browser egresses through `proxyUrl` (the exit-node tunnel), so
 * pages are fetched from the exit node's IP, JS-rendered, as LLM-ready markdown.
 */
@Injectable()
export class WebBrowseTool extends BaseTool<WebBrowseParams, WebBrowseRules> {
  getName(): string {
    return 'web_browse';
  }

  getAiDescription(): string {
    return 'Open a web page in a headless browser (JS-rendered) and return its content as markdown (or readability/cleaned_html/html). Use to read a specific URL in full — e.g. a result from `web_search`.';
  }

  getHumanDescription(): string {
    return 'Open a web page and read it.';
  }

  getParamsSchema(): unknown {
    return webBrowseParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(WebBrowseRulesSchema);
  }

  getDefaultRules(): WebBrowseRules {
    return WebBrowseRulesSchema.parse({});
  }

  parseParams(raw: unknown): WebBrowseParams {
    return parseWebBrowseParams(raw);
  }

  parseRules(raw: unknown): WebBrowseRules {
    return parseWebBrowseRules(raw);
  }

  /** Read-only retrieval — safe to run without a per-call prompt. */
  getDefaultPolicy(): ToolPolicy {
    return 'allow';
  }

  async runTool(params: WebBrowseParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseWebBrowseRules(context.toolRules ?? this.getDefaultRules());
    const endpoint = new URL('/v1/scrape', rules.endpoint);

    const payload: Record<string, unknown> = { url: params.url, format: [params.format] };
    // proxyUrl is per-call in Steel (its PROXY_URL env is a no-op); this is what
    // routes browser egress through the exit-node tunnel.
    if (rules.proxyUrl) payload.proxyUrl = rules.proxyUrl;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), rules.timeoutMs);
    const onParentAbort = () => controller.abort(context.signal.reason);
    if (context.signal.aborted) controller.abort(context.signal.reason);
    else context.signal.addEventListener('abort', onParentAbort, { once: true });

    try {
      const response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as ScrapeResponse;
      if (!response.ok) {
        const reason = body.message ?? body.error ?? `${response.status} ${response.statusText}`;
        throw new Error(`web_browse: ${reason}`);
      }
      const raw = body.content?.[params.format] ?? '';
      const truncated = raw.length > rules.maxResponseBytes;
      const content = truncated ? raw.slice(0, rules.maxResponseBytes) : raw;
      return {
        url: params.url,
        statusCode: body.metadata?.statusCode,
        title: body.metadata?.title,
        format: params.format,
        content,
        truncated,
        wordCount: body.metadata?.wordCount,
        links: params.includeLinks ? (body.links ?? []).map((l) => ({ url: l.url, text: l.text })) : undefined,
      };
    } catch (error) {
      if (context.signal.aborted) context.signal.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`web_browse: request timed out after ${rules.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener('abort', onParentAbort);
    }
  }
}
