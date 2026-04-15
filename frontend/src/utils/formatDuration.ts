const HAS_TZ = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/**
 * DB/API datetimes are UTC without `Z`. Parsing as local skews live timers by the user's offset.
 */
export function parseDbTimestampMs(value: unknown): number {
  if (value == null) return NaN;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let s = String(value).trim();
  if (!s) return NaN;
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    return s.length <= 10 ? n * 1000 : n;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !HAS_TZ.test(s)) s = `${s}Z`;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : NaN;
}

export type ThoughtMeta = {
  thoughtMs?: unknown;
  thoughtStartedAt?: unknown;
  thoughtEndedAt?: unknown;
};

/**
 * Duration for a thinking segment: prefer wall-clock pair (UTC), then server `thoughtMs`.
 */
export function thoughtDurationMs(meta: ThoughtMeta | null | undefined, messageCreatedAt?: string): number {
  const raw = meta?.thoughtMs;
  const fromServer = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(fromServer) && fromServer > 0) return fromServer;

  const start = meta?.thoughtStartedAt;
  let end = meta?.thoughtEndedAt;
  if (typeof end !== "string" || !end.trim()) {
    end = messageCreatedAt;
  }
  if (typeof start === "string" && start.trim() && typeof end === "string" && end.trim()) {
    const a = parseDbTimestampMs(start);
    const b = parseDbTimestampMs(end);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return b - a;
    }
  }
  return Number.isFinite(fromServer) ? fromServer : 0;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} sec`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} min ${Math.round(r)} sec`;
}
