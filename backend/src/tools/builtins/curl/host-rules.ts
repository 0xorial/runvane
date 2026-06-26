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

/**
 * Best-effort SSRF guard: rejects hosts that resolve to loopback, private,
 * or link-local space (incl. cloud metadata). This is a blocklist, not a
 * substitute for the `ask` policy + guardrail — it cannot catch every
 * obfuscation (octal/hex IPv4, IPv4-mapped IPv6, or DNS rebinding, where a
 * public name resolves to a private address at fetch time).
 */
export function isLocalHost(host: string): boolean {
  // IPv6 literals: URL.hostname strips the brackets, so `host` is e.g. `fe80::1`.
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true; // loopback / unspecified
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // unique-local fc00::/7
    return false;
  }
  // A bare integer host (e.g. 2130706433) is interpreted as an IPv4 address by
  // the network stack and is never a legitimate public hostname.
  if (/^\d+$/.test(host)) return true;
  if (host === 'localhost' || host === '0.0.0.0') return true;
  if (host.startsWith('127.')) return true; // loopback 127.0.0.0/8
  if (host.startsWith('10.')) return true; // private 10.0.0.0/8
  if (host.startsWith('192.168.')) return true; // private 192.168.0.0/16
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true; // private 172.16.0.0/12
  if (host.startsWith('169.254.')) return true; // link-local 169.254.0.0/16 (incl. cloud metadata)
  if (host.endsWith('.local')) return true;
  return false;
}
