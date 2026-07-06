import { WebSearchTool } from './tool.js';
import { isServiceUnreachable } from '../../fetch-failure.js';
import type { ToolRunContext } from '../../base-tool.js';

function contextWith(rules: Record<string, unknown>): ToolRunContext {
  return { toolRules: rules, signal: new AbortController().signal } as unknown as ToolRunContext;
}

describe('web_search without a reachable proxy', () => {
  it('fails with a configuration guide, not a bare errno', async () => {
    const tool = new WebSearchTool();
    // A high dead port — nothing listens there (low ports like 9 are on the fetch spec blocklist and fail differently).
    const context = contextWith({ endpoint: 'http://127.0.0.1:59999', timeoutMs: 3000 });
    await expect(tool.runTool({ query: 'hello', count: 3 }, context)).rejects.toThrow(
      /web_search is not available[\s\S]*RUNVANE_WEB_SEARCH_ENDPOINT[\s\S]*Settings → Agents/,
    );
  });
});

describe('isServiceUnreachable', () => {
  it('detects refused/DNS causes, also inside AggregateError', () => {
    const refused = new TypeError('fetch failed');
    (refused as { cause?: unknown }).cause = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    expect(isServiceUnreachable(refused)).toBe(true);

    const aggregate = new TypeError('fetch failed');
    const inner = Object.assign(new Error('getaddrinfo ENOTFOUND host'), { code: 'ENOTFOUND' });
    (aggregate as { cause?: unknown }).cause = Object.assign(new AggregateError([inner]), {});
    expect(isServiceUnreachable(aggregate)).toBe(true);
  });

  it('does not fire on HTTP-level or unrelated errors', () => {
    expect(isServiceUnreachable(new Error('web_search: GET … returned 500'))).toBe(false);
    const reset = new TypeError('fetch failed');
    (reset as { cause?: unknown }).cause = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    });
    expect(isServiceUnreachable(reset)).toBe(false);
  });
});
