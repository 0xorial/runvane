import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import { BaseTool, type ToolPolicy, type ToolRunContext } from '../../base-tool.js';
import { describeFetchFailure, isMidRequestDrop, isServiceUnreachable } from '../../fetch-failure.js';
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
 * Scrape failures that smell like a TLS handshake problem. Steel's headless
 * chromium reports outright cert errors as net::ERR_CERT_… / net::ERR_SSL_…,
 * but its scripted navigation also collapses cert rejections into the opaque
 * net::ERR_ABORTED (verified against a host whose certificate only covered
 * the apex domain), so that counts too — a spurious extra attempt on a
 * genuine abort costs one scrape call and nothing else.
 */
export function isTlsSuspectScrapeFailure(reason: string): boolean {
  return /net::ERR_(CERT_|SSL_|ABORTED)/.test(reason);
}

/**
 * The www↔apex sibling of an https URL: `www.host` → `host`, `host` →
 * `www.host`. Desktop chromium silently retries this variant when a cert
 * only covers the other host — headless scraping doesn't get that grace, so
 * the tool re-creates it. Returns null when no sensible sibling exists
 * (non-https, IP literals, localhost, single-label hosts).
 */
export function wwwApexVariant(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname;
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  url.hostname = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  return url.toString();
}

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

    const controller = new AbortController();
    // One timer across every attempt: the fallback shares the call's budget.
    const timer = setTimeout(() => controller.abort(), rules.timeoutMs);
    const onParentAbort = () => controller.abort(context.signal.reason);
    if (context.signal.aborted) controller.abort(context.signal.reason);
    else context.signal.addEventListener('abort', onParentAbort, { once: true });

    const scrape = async (
      url: string,
    ): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; reason: string }> => {
      const payload: Record<string, unknown> = { url, format: [params.format] };
      // proxyUrl is per-call in Steel (its PROXY_URL env is a no-op); this is what
      // routes browser egress through the exit-node tunnel.
      if (rules.proxyUrl) payload.proxyUrl = rules.proxyUrl;
      const response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as ScrapeResponse;
      if (!response.ok) {
        return { ok: false, reason: body.message ?? body.error ?? `${response.status} ${response.statusText}` };
      }
      const raw = body.content?.[params.format] ?? '';
      const truncated = raw.length > rules.maxResponseBytes;
      const content = truncated ? raw.slice(0, rules.maxResponseBytes) : raw;
      return {
        ok: true,
        value: {
          url,
          statusCode: body.metadata?.statusCode,
          title: body.metadata?.title,
          format: params.format,
          content,
          truncated,
          wordCount: body.metadata?.wordCount,
          links: params.includeLinks ? (body.links ?? []).map((l) => ({ url: l.url, text: l.text })) : undefined,
        },
      };
    };

    const withVariantNote = (value: Record<string, unknown>, variant: string, firstReason: string) => ({
      ...value,
      requestedUrl: params.url,
      note:
        `Fetched ${variant} instead: ${params.url} failed (${firstReason}) — ` +
        `the site's TLS certificate likely covers only this host variant. Use ${variant} for follow-up requests.`,
    });
    // Steel needs a few seconds to relaunch its browser after a scrape crashes
    // it; resolves early on abort so the next fetch surfaces the AbortError.
    const relaunchGrace = () =>
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 6_000);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });

    try {
      let first: Awaited<ReturnType<typeof scrape>>;
      try {
        first = await scrape(params.url);
      } catch (error) {
        // Mid-request drop: the enabler was reachable but died on this exact
        // scrape — Steel's browser crashes on some cert-rejected navigations,
        // so a www↔apex sibling is worth one delayed attempt. Anything else
        // (service down, abort) falls through to the generic handling.
        const variant = isMidRequestDrop(error) ? wwwApexVariant(params.url) : null;
        if (!variant) throw error;
        await relaunchGrace();
        const second = await scrape(variant).catch(() => null);
        if (!second?.ok) throw error; // report the original drop
        return withVariantNote(second.value, variant, describeFetchFailure(error));
      }
      if (first.ok) return first.value;

      // TLS-suspect failure: mirror desktop chromium's www↔apex grace. Sites
      // whose certificate covers only one of the two variants open fine in a
      // normal browser (it silently swaps hosts) but hard-fail a headless
      // scrape — retry the sibling host once before giving up.
      const variant = isTlsSuspectScrapeFailure(first.reason) ? wwwApexVariant(params.url) : null;
      if (variant) {
        // The cert-rejected navigation crashes Steel's browser AND poisons its
        // connections for a few seconds (measured: immediate follow-ups get
        // ECONNRESET, +6s succeeds) — so the sibling attempt needs the same
        // relaunch grace as the socket-drop path, and must swallow its own
        // transport failures rather than mask the original error.
        await relaunchGrace();
        let second: Awaited<ReturnType<typeof scrape>> | null = null;
        let secondError: unknown;
        try {
          second = await scrape(variant);
        } catch (err) {
          secondError = err;
        }
        if (second?.ok) return withVariantNote(second.value, variant, first.reason);
        const secondReason = second ? second.reason : describeFetchFailure(secondError);
        throw new Error(
          `web_browse: ${params.url} via ${endpoint.toString()} failed — ${first.reason} ` +
            `(looks like a TLS certificate problem; the www/apex sibling ${variant} also failed: ${secondReason})`,
        );
      }
      const tlsHint = isTlsSuspectScrapeFailure(first.reason)
        ? ' (this often means a TLS certificate problem the headless browser cannot bypass)'
        : '';
      throw new Error(`web_browse: ${params.url} via ${endpoint.toString()} failed — ${first.reason}${tlsHint}`);
    } catch (error) {
      if (context.signal.aborted) context.signal.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`web_browse: ${params.url} via ${endpoint.toString()} timed out after ${rules.timeoutMs}ms`);
      }
      // Already-formatted errors pass through; wrap raw fetch failures with the
      // target URL, the endpoint, and the real cause (not "fetch failed").
      if (error instanceof Error && error.message.startsWith('web_browse:')) throw error;
      // No browse proxy at the configured endpoint: guide the user to set one
      // up instead of surfacing a bare errno.
      if (isServiceUnreachable(error)) {
        throw new Error(
          `web_browse is not available: no browse proxy is reachable at ${rules.endpoint} (${describeFetchFailure(error)}). ` +
            `This tool needs a Steel-compatible scrape endpoint — e.g. the ai-browsing-enabler (start it with docker compose; it serves scraping on :3000). ` +
            `Point the tool at it by setting the RUNVANE_WEB_BROWSE_ENDPOINT env var for the backend, ` +
            `or per agent via Settings → Agents → Tools → web_browse → endpoint rule. ` +
            `Until then, answer from existing knowledge and tell the user web browsing is unconfigured.`,
        );
      }
      throw new Error(
        `web_browse: ${params.url} via ${endpoint.toString()} failed — ${describeFetchFailure(error)}`,
      );
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener('abort', onParentAbort);
    }
  }
}
