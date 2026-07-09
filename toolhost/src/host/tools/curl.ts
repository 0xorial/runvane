import type { TargetTool } from '../server.ts';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type Method = (typeof ALLOWED_METHODS)[number];

type CurlParams = {
  url: string;
  method: Method;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  followRedirects: boolean;
};

const TIMEOUT_MS = { min: 100, max: 60_000, default: 10_000 };
const RESPONSE_BYTES = { min: 256, max: 1_000_000, default: 50_000 };

/**
 * HTTP client running IN the sandbox: requests originate from the target's
 * network, so the agent can call services it started there (localhost dev
 * servers included) — the sandbox boundary is the security boundary, exactly
 * as for `exec`. The params/output contract mirrors the retired harness
 * builtin so existing prompts and presets keep working.
 */
export const curlTool: TargetTool = {
  name: 'curl',
  aiDescription:
    'Send an HTTP request from inside the sandbox and return status, headers, and response text (truncated to limits). ' +
    'Requests originate from the sandbox network, so localhost/dev services running there are reachable.',
  humanDescription: 'Call an HTTP endpoint (curl-style) from the sandbox.',
  paramsSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', minLength: 1, description: 'Absolute URL to request (http/https).' },
      method: { type: 'string', enum: [...ALLOWED_METHODS], default: 'GET' },
      headers: { type: 'object', additionalProperties: { type: 'string' }, default: {} },
      body: { type: 'string', description: 'Optional request body for POST/PUT/PATCH/DELETE.' },
      timeoutMs: {
        type: 'integer',
        minimum: TIMEOUT_MS.min,
        maximum: TIMEOUT_MS.max,
        default: TIMEOUT_MS.default,
      },
      maxResponseBytes: {
        type: 'integer',
        minimum: RESPONSE_BYTES.min,
        maximum: RESPONSE_BYTES.max,
        default: RESPONSE_BYTES.default,
      },
      followRedirects: { type: 'boolean', default: true },
    },
    required: ['url'],
    additionalProperties: false,
  },
  parseParams(raw): CurlParams {
    const p = (raw ?? {}) as Record<string, unknown>;
    if (typeof p.url !== 'string' || p.url.trim() === '') {
      throw new Error('curl: `url` (non-empty string) is required');
    }
    let parsed: URL;
    try {
      parsed = new URL(p.url);
    } catch {
      throw new Error('curl: invalid absolute URL');
    }
    const scheme = parsed.protocol.toLowerCase();
    if (scheme !== 'https:' && scheme !== 'http:') {
      throw new Error('curl: only http/https URLs are supported');
    }
    const method = (p.method ?? 'GET') as Method;
    if (!ALLOWED_METHODS.includes(method)) {
      throw new Error(`curl: method must be one of ${ALLOWED_METHODS.join(', ')}`);
    }
    const headers: Record<string, string> = {};
    if (p.headers && typeof p.headers === 'object' && !Array.isArray(p.headers)) {
      for (const [key, value] of Object.entries(p.headers as Record<string, unknown>)) {
        if (typeof value !== 'string') throw new Error(`curl: header '${key}' must be a string`);
        headers[key] = value;
      }
    }
    const clampInt = (value: unknown, range: { min: number; max: number; default: number }, label: string): number => {
      if (value === undefined || value === null) return range.default;
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`curl: ${label} must be a number`);
      return Math.min(range.max, Math.max(range.min, Math.trunc(n)));
    };
    const out: CurlParams = {
      url: parsed.toString(),
      method,
      headers,
      timeoutMs: clampInt(p.timeoutMs, TIMEOUT_MS, 'timeoutMs'),
      maxResponseBytes: clampInt(p.maxResponseBytes, RESPONSE_BYTES, 'maxResponseBytes'),
      followRedirects: p.followRedirects === undefined ? true : Boolean(p.followRedirects),
    };
    if (typeof p.body === 'string') out.body = p.body;
    return out;
  },
  async run(params, ctx) {
    const p = params as CurlParams;
    const start = Date.now();
    const body = p.method === 'GET' || p.method === 'HEAD' ? undefined : p.body;
    ctx.log(`${p.method} ${p.url} (timeout ${p.timeoutMs}ms)`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), p.timeoutMs);
    const onAbort = (): void => controller.abort(ctx.signal.reason);
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(p.url, {
        method: p.method,
        headers: p.headers,
        body,
        signal: controller.signal,
        redirect: p.followRedirects ? 'follow' : 'manual',
      });
      if (response.url && response.url !== p.url) ctx.log(`redirected to ${response.url}`);
      ctx.log(`${response.status} ${response.statusText} in ${Date.now() - start}ms`);
      const { bytes, truncated } = await readBodyCapped(response, p.maxResponseBytes);
      ctx.log(`read ${bytes.length} bytes${truncated ? ' (truncated)' : ''}`);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        request: {
          url: p.url,
          method: p.method,
          headers: p.headers,
          timeoutMs: p.timeoutMs,
          maxResponseBytes: p.maxResponseBytes,
        },
        response: {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          contentType: response.headers.get('content-type') ?? '',
          headers,
          bodyText: new TextDecoder().decode(bytes),
          bodyBytes: bytes.byteLength,
          truncated,
          durationMs: Date.now() - start,
        },
      };
    } catch (error) {
      // A steering/user cancel must surface as an AbortError (clean cancel),
      // not be mislabelled as a timeout.
      if (ctx.signal.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`curl: request timed out after ${p.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
};

async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;
    if (total >= maxBytes) {
      truncated = true;
      continue;
    }
    const remain = maxBytes - total;
    if (value.length > remain) {
      chunks.push(value.subarray(0, remain));
      total += remain;
      truncated = true;
      continue;
    }
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated };
}
