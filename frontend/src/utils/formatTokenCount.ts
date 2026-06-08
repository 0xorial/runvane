export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(2))}M tok`;
  if (n >= 1_000) return `${parseFloat((n / 1_000).toFixed(2))}k tok`;
  return `${n} tok`;
}
