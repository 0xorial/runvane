const SKIP_PREFIXES = [
  'node:',
  'node:internal',
  'async-hooks-monitor',
  'async-entry-patches',
  'capture-creation-stack',
];

export type OriginClass = 'none' | 'app' | 'framework' | 'unknown';

export function captureCreationStack(): string[] {
  const raw = new Error().stack?.split('\n').slice(3) ?? [];
  const lines: string[] = [];
  for (const line of raw) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    if (SKIP_PREFIXES.some((p) => trimmed.includes(p))) continue;
    lines.push(trimmed);
    if (lines.length >= 10) break;
  }
  return lines;
}

export function firstAppSite(stack: readonly string[]): string | null {
  for (const frame of stack) {
    const idx = frame.indexOf('/runvane/backend/src/');
    if (idx < 0) continue;
    return frame.slice(idx + '/runvane/backend/'.length).replace(/\)$/, '').trim();
  }
  return null;
}

function shortenNodeModules(frame: string): string {
  const idx = frame.indexOf('node_modules/');
  if (idx < 0) return frame;
  return frame.slice(idx + 'node_modules/'.length).replace(/\)$/, '').trim();
}

function isHttpPipelineSite(site: string): boolean {
  return (
    site.includes('.interceptor.') ||
    site.includes('.guard.') ||
    site.includes('.pipe.') ||
    site.includes('middleware')
  );
}

function isNestPipelineStack(stack: readonly string[]): boolean {
  return stack.some((f) => f.includes('interceptors-consumer'));
}

/** Distinguish your code vs Nest/RxJS/node_modules vs opaque native handles. */
export function classifyOrigin(stack: readonly string[]): { kind: OriginClass; label: string | null } {
  const appSite = firstAppSite(stack);
  if (appSite) {
    if (isHttpPipelineSite(appSite) || isNestPipelineStack(stack)) {
      return { kind: 'framework', label: `HTTP pipeline · ${appSite}` };
    }
    return { kind: 'app', label: appSite };
  }

  for (const frame of stack) {
    if (!frame.includes('node_modules/')) continue;
    const site = shortenNodeModules(frame);
    if (frame.includes('@nestjs/')) return { kind: 'framework', label: `NestJS · ${site}` };
    if (frame.includes('/rxjs/')) return { kind: 'framework', label: `RxJS · ${site}` };
    return { kind: 'framework', label: site };
  }
  return { kind: 'unknown', label: null };
}
