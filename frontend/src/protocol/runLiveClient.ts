import { API_BASE_URL } from "../api/client";
import { rvInfo } from "../utils/runvaneDiag";
import { parseSseEventObject } from "./parseSseEventObject";
import type { SseEvent } from "./sseTypes";

type PollTick = () => Promise<boolean> | boolean;

export type GlobalLiveHandlers = {
  onSseEvent: (ev: SseEvent) => void;
  /** HTTP catch-up while SSE is down. Return true to stop polling for this subscription. */
  onPollTick?: PollTick;
};

const DEFAULT_POLL_MS = 450;
const DEFAULT_RECOVERY_MS = 2500;
const DEFAULT_MAX_RECOVERY_WAITS = 12;
const LAST_SEQ_STORAGE_KEY = "runvane:sse:last-seq";

type LiveSubscription = GlobalLiveHandlers;

function readLastSeenSeq(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_SEQ_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  } catch {
    return null;
  }
}

function writeLastSeenSeq(seq: number): void {
  try {
    window.localStorage.setItem(LAST_SEQ_STORAGE_KEY, String(Math.trunc(seq)));
  } catch {
    // Best-effort only.
  }
}

type GlobalLiveOptions = {
  apiBaseUrl?: string;
  pollIntervalMs?: number;
  recoveryCheckMs?: number;
  maxRecoveryWaits?: number;
};

let es: EventSource | null = null;
let disposed = false;
let recoveryWaits = 0;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackPollId: ReturnType<typeof setInterval> | null = null;
let activeOptions: GlobalLiveOptions | undefined;
const subscribers = new Set<LiveSubscription>();

function cleanupGlobal(): void {
  if (recoveryTimer != null) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  if (fallbackPollId != null) clearInterval(fallbackPollId);
  fallbackPollId = null;
  if (es != null) {
    try {
      es.close();
    } catch (e) {
      console.error("[runvane] EventSource.close failed", e);
    }
  }
  es = null;
}

function maybeCleanupGlobal(): void {
  if (subscribers.size === 0) cleanupGlobal();
}

function hasPollTicks(): boolean {
  for (const sub of subscribers) {
    if (sub.onPollTick) return true;
  }
  return false;
}

function startFallbackLoop(pollMs: number): void {
  if (fallbackPollId != null) return;
  fallbackPollId = setInterval(() => {
    void (async () => {
      ensureGlobalSse();
      if (es?.readyState === EventSource.OPEN) return;

      if (!hasPollTicks()) {
        maybeCleanupGlobal();
        return;
      }

      for (const sub of [...subscribers]) {
        const tick = sub.onPollTick;
        if (!tick) continue;
        try {
          const stop = await tick();
          if (stop === true) sub.onPollTick = undefined;
        } catch (e) {
          console.error("[runvane] global poll tick failed", e);
        }
      }
      maybeCleanupGlobal();
    })();
  }, pollMs);
}

function ensureGlobalSse(options?: GlobalLiveOptions): void {
  if (options) activeOptions = options;
  if (es != null || disposed) return;

  const base = activeOptions?.apiBaseUrl ?? API_BASE_URL;
  const afterSeq = readLastSeenSeq();
  const streamUrl =
    afterSeq != null && afterSeq > 0
      ? `${base}/api/stream?after_seq=${encodeURIComponent(String(afterSeq))}`
      : `${base}/api/stream`;
  const pollMs = activeOptions?.pollIntervalMs ?? DEFAULT_POLL_MS;
  const recoveryMs = activeOptions?.recoveryCheckMs ?? DEFAULT_RECOVERY_MS;
  const maxWaits = activeOptions?.maxRecoveryWaits ?? DEFAULT_MAX_RECOVERY_WAITS;
  es = new EventSource(streamUrl);

  const scheduleRecovery = () => {
    if (recoveryTimer != null || es == null) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (disposed || es === null) return;
      if (es.readyState === EventSource.OPEN) return;
      if (es.readyState === EventSource.CLOSED) {
        cleanupGlobal();
        startFallbackLoop(pollMs);
        return;
      }
      recoveryWaits += 1;
      if (recoveryWaits >= maxWaits) {
        cleanupGlobal();
        startFallbackLoop(pollMs);
        return;
      }
      scheduleRecovery();
    }, recoveryMs);
  };

  es.onopen = () => {
    recoveryWaits = 0;
    if (recoveryTimer != null) clearTimeout(recoveryTimer);
    recoveryTimer = null;
    if (fallbackPollId != null) {
      clearInterval(fallbackPollId);
      fallbackPollId = null;
    }
    rvInfo("[runvane:sse] EventSource OPEN", streamUrl);
  };

  es.onerror = () => {
    if (disposed || es === null) return;
    if (fallbackPollId != null) return;
    scheduleRecovery();
  };

  es.onmessage = (event) => {
    if (disposed) return;
    try {
      const raw = JSON.parse(event.data) as unknown;
      const ev = parseSseEventObject(raw);
      if (!ev) return;
      if (typeof ev.seq === "number" && Number.isFinite(ev.seq)) {
        writeLastSeenSeq(ev.seq);
      }
      for (const sub of [...subscribers]) {
        sub.onSseEvent(ev);
      }
    } catch (err) {
      console.error("[runvane] global SSE message error", err);
    }
  };
}

export function subscribeGlobalLive(
  handlers: GlobalLiveHandlers,
  options?: GlobalLiveOptions,
): () => void {
  disposed = false;
  const sub: LiveSubscription = {
    onSseEvent: handlers.onSseEvent,
    onPollTick: handlers.onPollTick,
  };
  subscribers.add(sub);
  ensureGlobalSse(options);
  return () => {
    subscribers.delete(sub);
    maybeCleanupGlobal();
  };
}
