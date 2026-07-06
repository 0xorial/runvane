import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import { BaseTool, type ToolPolicy, type ToolRunContext } from '../../base-tool.js';
import { describeFetchFailure, isServiceUnreachable } from '../../fetch-failure.js';
import { parseWebSearchParams, webSearchParamsSchema, type WebSearchParams } from './params.js';
import { WebSearchRulesSchema, parseWebSearchRules, type WebSearchRules } from './rules.js';

/** Shape of the SearXNG `?format=json` response (only the fields we surface). */
type SearxResult = {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  publishedDate?: string | null;
};
type SearxResponse = { results?: SearxResult[]; suggestions?: string[] };

/**
 * Harness tool: web search via a SearXNG JSON endpoint (e.g. the
 * `ai-browsing-enabler`, whose upstream queries egress through an exit node).
 */
@Injectable()
export class WebSearchTool extends BaseTool<WebSearchParams, WebSearchRules> {
  getName(): string {
    return 'web_search';
  }

  getAiDescription(): string {
    return 'Search the web and return ranked results (title, url, snippet). Use when you need fresh, real-world information; then read a promising result in full with `web_browse`.';
  }

  getHumanDescription(): string {
    return 'Search the web.';
  }

  getParamsSchema(): unknown {
    return webSearchParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(WebSearchRulesSchema);
  }

  getDefaultRules(): WebSearchRules {
    return WebSearchRulesSchema.parse({});
  }

  parseParams(raw: unknown): WebSearchParams {
    return parseWebSearchParams(raw);
  }

  parseRules(raw: unknown): WebSearchRules {
    return parseWebSearchRules(raw);
  }

  /** Read-only retrieval — safe to run without a per-call prompt. */
  getDefaultPolicy(): ToolPolicy {
    return 'allow';
  }

  async runTool(params: WebSearchParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseWebSearchRules(context.toolRules ?? this.getDefaultRules());
    const limit = Math.min(params.count, rules.maxResults);

    const url = new URL('/search', rules.endpoint);
    url.searchParams.set('q', params.query);
    url.searchParams.set('format', 'json');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), rules.timeoutMs);
    // Cancel the in-flight request when the run is steered/aborted, not just on timeout.
    const onParentAbort = () => controller.abort(context.signal.reason);
    if (context.signal.aborted) controller.abort(context.signal.reason);
    else context.signal.addEventListener('abort', onParentAbort, { once: true });

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        const snippet = (await response.text().catch(() => '')).trim().slice(0, 300);
        throw new Error(
          `web_search: GET ${url.toString()} returned ${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`,
        );
      }
      const body = (await response.json()) as SearxResponse;
      const results = (body.results ?? []).slice(0, limit).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.content ?? '',
        engine: r.engine,
        publishedDate: r.publishedDate ?? undefined,
      }));
      return {
        query: params.query,
        count: results.length,
        results,
        suggestions: body.suggestions?.length ? body.suggestions.slice(0, 5) : undefined,
      };
    } catch (error) {
      // A steering/user cancel must surface as an AbortError, not a timeout.
      if (context.signal.aborted) context.signal.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`web_search: GET ${url.toString()} timed out after ${rules.timeoutMs}ms`);
      }
      // Already-formatted (e.g. non-2xx) errors pass through; wrap raw fetch
      // failures with the URL attempted and the real cause (not "fetch failed").
      if (error instanceof Error && error.message.startsWith('web_search:')) throw error;
      // No search proxy at the configured endpoint: guide the user to set one
      // up instead of surfacing a bare errno.
      if (isServiceUnreachable(error)) {
        throw new Error(
          `web_search is not available: no search proxy is reachable at ${rules.endpoint} (${describeFetchFailure(error)}). ` +
            `This tool needs a SearXNG-compatible JSON endpoint — e.g. the ai-browsing-enabler (start it with docker compose; it serves search on :8080). ` +
            `Point the tool at it by setting the RUNVANE_WEB_SEARCH_ENDPOINT env var for the backend, ` +
            `or per agent via Settings → Agents → Tools → web_search → endpoint rule. ` +
            `Until then, answer from existing knowledge and tell the user web search is unconfigured.`,
        );
      }
      throw new Error(`web_search: GET ${url.toString()} failed — ${describeFetchFailure(error)}`);
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener('abort', onParentAbort);
    }
  }
}
