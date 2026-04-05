import { API_BASE_URL } from "../api/client";
import { rvInfo } from "../utils/runvaneDiag";
import { parseSseEventObject } from "./parseSseEventObject";
import type { SseEvent } from "./sseTypes";

export type GlobalLiveHandlers = {
  onSseEvent: (ev: SseEvent) => void;
  pollTick: () => Promise<boolean>;
};

const DEFAULT_POLL_MS = 450;
const DEFAULT_RECOVERY_MS = 2500;
const DEFAULT_MAX_RECOVERY_WAITS = 12;

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
let pollId: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<GlobalLiveHandlers>();

function cleanupGlobal(): void {
  if (recoveryTimer != null) clearTimeout(recoveryTimer);
  recoveryTimer = null;
  if (pollId != null) clearInterval(pollId);
  pollId = null;
  if (es != null) {
    try {
      es.close();
    } catch (e) {
      console.error("[runvane] EventSource.close failed", e);
    }
  }
  es = null;
}

function startPoll(pollMs: number): void {
  if (pollId != null) return;
  pollId = setInterval(() => {
    void (async () => {
      for (const sub of [...subscribers]) {
        try {
          const stop = await sub.pollTick();
          if (stop) subscribers.delete(sub);
        } catch (e) {
          console.error("[runvane] global poll tick failed", e);
        }
      }
      if (subscribers.size === 0) cleanupGlobal();
    })();
  }, pollMs);
}

function ensureGlobalSse(options?: GlobalLiveOptions): void {
  if (es != null || disposed) return;
  const base = options?.apiBaseUrl ?? API_BASE_URL;
  const streamUrl = `${base}/api/stream`;
  const pollMs = options?.pollIntervalMs ?? DEFAULT_POLL_MS;
  const recoveryMs = options?.recoveryCheckMs ?? DEFAULT_RECOVERY_MS;
  const maxWaits = options?.maxRecoveryWaits ?? DEFAULT_MAX_RECOVERY_WAITS;
  es = new EventSource(streamUrl);

  const scheduleRecovery = () => {
    if (recoveryTimer != null || es == null) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (disposed || es === null) return;
      if (es.readyState === EventSource.OPEN) return;
      if (es.readyState === EventSource.CLOSED) {
        cleanupGlobal();
        startPoll(pollMs);
        return;
      }
      recoveryWaits += 1;
      if (recoveryWaits >= maxWaits) {
        cleanupGlobal();
        startPoll(pollMs);
        return;
      }
      scheduleRecovery();
    }, recoveryMs);
  };

  es.onopen = () => {
    recoveryWaits = 0;
    if (recoveryTimer != null) clearTimeout(recoveryTimer);
    recoveryTimer = null;
    if (pollId != null) {
      clearInterval(pollId);
      pollId = null;
    }
    rvInfo("[runvane:sse] EventSource OPEN", streamUrl);
  };

  es.onerror = () => {
    if (disposed || es === null) return;
    if (pollId != null) return;
    scheduleRecovery();
  };

  es.onmessage = (event) => {
    if (disposed) return;
    try {
      const raw = JSON.parse(event.data) as unknown;
      const ev = parseSseEventObject(raw);
      if (!ev) return;
      rvInfo("[runvane:sse] parsed", ev.type);
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
  options?: {
    apiBaseUrl?: string;
    pollIntervalMs?: number;
    recoveryCheckMs?: number;
    maxRecoveryWaits?: number;
  },
): () => void {
  disposed = false;
  subscribers.add(handlers);
  ensureGlobalSse(options);
  return () => {
    subscribers.delete(handlers);
    if (subscribers.size === 0) cleanupGlobal();
  };
}
