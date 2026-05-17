export function matchesHostList(host: string, list: string[]): boolean {
  for (const entryRaw of list) {
    const entry = entryRaw.trim().toLowerCase();
    if (!entry) continue;
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      if (host.endsWith(suffix)) return true;
      continue;
    }
    if (host === entry) return true;
  }
  return false;
}

export function isLocalHost(host: string): boolean {
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1') return true;
  if (host === '169.254.169.254') return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host.endsWith('.local')) return true;
  return false;
}
