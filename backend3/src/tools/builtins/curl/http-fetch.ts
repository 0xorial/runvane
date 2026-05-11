export async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;
    if (total >= maxBytes) {
      truncated = true;
      continue;
    }
    const remain = maxBytes - total;
    if (value.length > remain) {
      chunks.push(value.subarray(0, remain));
      total += remain;
      truncated = true;
      continue;
    }
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, truncated };
}

export function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function parseAbsoluteUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new Error('curl: invalid absolute URL');
  }
}
