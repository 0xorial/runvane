export async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function parseStubDelayMs(text: string): number | null {
  const match = text.match(/__stub_delay:(\d+)__/);
  if (!match?.[1]) return null;
  const ms = Number(match[1]);
  if (!Number.isFinite(ms) || ms < 0 || ms > 60_000) return null;
  return Math.trunc(ms);
}

export function isSteerProbeMessage(text: string): boolean {
  return text.includes('__steer_probe__');
}

export function steerProbeReply(): string {
  return JSON.stringify({
    assistant_output: 'Steered response.',
    tool_requests: [],
    followup: 'finalize',
  });
}
