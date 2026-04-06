/**
 * Relative labels for the chat sidebar (e.g. "30 minutes ago").
 */
export function formatRelativeChatTime(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const diffMs = Date.now() - t;
  if (diffMs < 0) {
    const min = Math.ceil(-diffMs / 60_000);
    if (min < 60) return rtf.format(min, "minute");
    const hr = Math.ceil(-diffMs / 3_600_000);
    return rtf.format(hr, "hour");
  }
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.floor(diffMs / 3_600_000);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.floor(diffMs / 86_400_000);
  if (day < 7) return rtf.format(-day, "day");
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: diffMs > 365 * 86_400_000 ? "numeric" : undefined,
  });
}
