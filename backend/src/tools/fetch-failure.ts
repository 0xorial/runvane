/**
 * Extract a specific, actionable message from a failed `fetch()`.
 *
 * Node surfaces only a generic `TypeError: fetch failed` and hides the real
 * reason (DNS/connection/TLS) in `error.cause` — and for multi-address hosts in
 * `cause.errors` (an AggregateError). This walks those so callers can report the
 * actual `ECONNREFUSED` / `ENOTFOUND` / `ETIMEDOUT` etc. instead of "fetch failed".
 */
export function describeFetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const seen: string[] = [];
  const push = (e: unknown): void => {
    if (e instanceof Error) {
      const code = (e as { code?: string }).code;
      const msg = code && !e.message.includes(code) ? `${code}: ${e.message}` : e.message;
      if (msg && !seen.includes(msg)) seen.push(msg);
      const nested = (e as { errors?: unknown[] }).errors;
      if (Array.isArray(nested)) nested.forEach(push);
    } else if (e != null && e !== '') {
      const s = String(e);
      if (!seen.includes(s)) seen.push(s);
    }
  };
  push((error as { cause?: unknown }).cause);
  if (seen.length === 0) seen.push(error.message);
  return seen.join('; ');
}

// Errno codes that mean "nothing is listening there" (service down, wrong
// host, DNS miss) — as opposed to a flaky-but-present service.
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * True when a failed `fetch()` indicates the target service is not reachable
 * at all — the caller can then explain how to configure/start it instead of
 * surfacing a bare errno.
 */
export function isServiceUnreachable(error: unknown): boolean {
  // Duck-typed rather than `instanceof Error`: undici error causes can come
  // from another realm (notably under jest's VM), where instanceof fails.
  const walk = (e: unknown): boolean => {
    if (e == null || typeof e !== 'object') return false;
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && UNREACHABLE_CODES.has(code)) return true;
    const nested = (e as { errors?: unknown[] }).errors;
    if (Array.isArray(nested) && nested.some(walk)) return true;
    return walk((e as { cause?: unknown }).cause);
  };
  return walk(error);
}

// Errno codes that mean "the service accepted the connection, then died on
// THIS request" — the peer dropped mid-exchange, as opposed to nothing
// listening (UNREACHABLE_CODES) or a flaky-but-clean error response.
const MID_REQUEST_DROP_CODES = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']);

/**
 * True when a failed `fetch()` died mid-request: the service was there and
 * closed the socket on us. Distinct from {@link isServiceUnreachable} — a
 * caller may reasonably retry (the request itself likely crashed the peer).
 */
export function isMidRequestDrop(error: unknown): boolean {
  const walk = (e: unknown): boolean => {
    if (e == null || typeof e !== 'object') return false;
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && MID_REQUEST_DROP_CODES.has(code)) return true;
    const nested = (e as { errors?: unknown[] }).errors;
    if (Array.isArray(nested) && nested.some(walk)) return true;
    return walk((e as { cause?: unknown }).cause);
  };
  return walk(error);
}
