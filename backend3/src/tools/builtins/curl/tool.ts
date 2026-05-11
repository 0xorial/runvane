import { Injectable } from '@nestjs/common';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { curlParamsSchema, parseCurlToolParams, type CurlToolParams } from './params.js';
import { curlRulesSchema, parseCurlToolRules, type CurlToolRules } from './rules.js';
import { isLocalHost, matchesHostList } from './host-rules.js';
import { headersToObject, parseAbsoluteUrl, readBodyCapped } from './http-fetch.js';

@Injectable()
export class CurlTool extends BaseTool<CurlToolParams, CurlToolRules> {
  getName(): string {
    return 'curl';
  }

  getAiDescription(): string {
    return 'Send an HTTP request to a public URL and return status, headers, and response text (truncated to limits). Use when fresh web/API data is needed.';
  }

  getHumanDescription(): string {
    return 'Call an HTTP endpoint (curl-style).';
  }

  getParamsSchema(): Record<string, unknown> {
    return curlParamsSchema();
  }

  getRulesSchema(): Record<string, unknown> {
    return curlRulesSchema();
  }

  getDefaultRules(): CurlToolRules {
    return {
      allowed: 'ask',
      allowHttp: false,
      allowedHosts: [],
      blockedHosts: ['localhost', '127.0.0.1', '::1', '0.0.0.0', '169.254.169.254'],
      maxTimeoutMs: 10000,
      maxResponseBytes: 50000,
    };
  }

  parseParams(raw: unknown): CurlToolParams {
    return parseCurlToolParams(raw);
  }

  parseRules(raw: unknown): CurlToolRules {
    return parseCurlToolRules(raw);
  }

  evaluatePermission(context: ToolPermissionContext<CurlToolRules>): RuleEvaluationResult[] {
    const allowedRule = context.agentToolConfig.rules.allowed;
    const permission = allowedRule === 'always' ? 'allow' : allowedRule === 'never' ? 'forbid' : 'ask_user';
    return [
      {
        ruleName: 'allowed',
        permission,
        detail: `Rule allowed='${allowedRule}'.`,
      },
    ];
  }

  async runTool(params: CurlToolParams, context: ToolRunContext): Promise<unknown> {
    const start = Date.now();
    const url = parseAbsoluteUrl(params.url);
    const rules = parseCurlToolRules(context.toolRules ?? this.getDefaultRules());
    this.assertSchemeAllowed(url, rules);
    this.assertHostAllowed(url, rules);

    const timeoutMs = Math.min(params.timeoutMs, rules.maxTimeoutMs);
    const maxBytes = Math.min(params.maxResponseBytes, rules.maxResponseBytes);
    const body = params.method === 'GET' || params.method === 'HEAD' ? undefined : params.body;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url.toString(), {
        method: params.method,
        headers: params.headers,
        body,
        signal: controller.signal,
        redirect: params.followRedirects ? 'follow' : 'manual',
      });
      const { bytes, truncated } = await readBodyCapped(response, maxBytes);
      const contentType = response.headers.get('content-type') ?? '';
      const bodyText = new TextDecoder().decode(bytes);
      return {
        request: {
          url: url.toString(),
          method: params.method,
          headers: params.headers,
          timeoutMs,
          maxResponseBytes: maxBytes,
          conversationId: context.conversationId,
        },
        response: {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          contentType,
          headers: headersToObject(response.headers),
          bodyText,
          bodyBytes: bytes.byteLength,
          truncated,
          durationMs: Date.now() - start,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`curl: request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private assertSchemeAllowed(url: URL, rules: CurlToolRules): void {
    const scheme = url.protocol.toLowerCase();
    if (scheme !== 'https:' && scheme !== 'http:') {
      throw new Error('curl: only http/https URLs are supported');
    }
    if (scheme === 'http:' && !rules.allowHttp) {
      throw new Error('curl: http is blocked by rule allowHttp=false');
    }
  }

  private assertHostAllowed(url: URL, rules: CurlToolRules): void {
    const host = url.hostname.toLowerCase();
    if (isLocalHost(host)) {
      throw new Error(`curl: blocked local host '${host}'`);
    }
    if (matchesHostList(host, rules.blockedHosts)) {
      throw new Error(`curl: host '${host}' is blocked`);
    }
    if (rules.allowedHosts.length > 0 && !matchesHostList(host, rules.allowedHosts)) {
      throw new Error(`curl: host '${host}' not in allowedHosts`);
    }
  }
}
