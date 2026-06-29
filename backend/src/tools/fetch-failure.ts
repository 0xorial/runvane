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
