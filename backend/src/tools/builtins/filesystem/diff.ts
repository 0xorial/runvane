/**
 * Minimal unified diff for edit_file results. Not a full Myers diff — it finds
 * the changed region by trimming the common prefix/suffix of lines, then emits
 * one hunk (removed lines, added lines) with a few lines of surrounding
 * context. Enough for the transcript row to show exactly what an edit changed
 * without pulling in a diff dependency.
 */

const CONTEXT = 3;

export function unifiedDiff(before: string, after: string, label: string): string {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');

  // Common leading lines.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  // Common trailing lines (not crossing into the shared prefix).
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ctxStart = Math.max(0, start - CONTEXT);
  const ctxEndA = Math.min(a.length, endA + CONTEXT);
  const ctxEndB = Math.min(b.length, endB + CONTEXT);

  const lines: string[] = [`--- ${label}`, `+++ ${label}`, `@@ -${ctxStart + 1},${ctxEndA - ctxStart} +${ctxStart + 1},${ctxEndB - ctxStart} @@`];
  for (let i = ctxStart; i < start; i++) lines.push(` ${a[i]}`);
  for (let i = start; i < endA; i++) lines.push(`-${a[i]}`);
  for (let i = start; i < endB; i++) lines.push(`+${b[i]}`);
  // Trailing context is shared, so index into either; use `a` past endA.
  for (let i = endA; i < ctxEndA; i++) lines.push(` ${a[i]}`);
  return lines.join('\n');
}
