import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import { BaseTool, type ToolPolicy, type ToolRunContext } from '../../base-tool.js';
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
        throw new Error(`web_search: search service returned ${response.status} ${response.statusText}`);
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
        throw new Error(`web_search: request timed out after ${rules.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener('abort', onParentAbort);
    }
  }
}
