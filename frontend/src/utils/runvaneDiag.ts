/** Visible in default DevTools levels (unlike `console.debug`). */
export function rvDiagEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return globalThis.localStorage?.getItem("runvaneDiag") === "1";
  } catch {
    return false;
  }
}

export function rvInfo(...args: unknown[]): void {
  if (rvDiagEnabled()) console.info(...args);
}
