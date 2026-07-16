// Context-injection (files) API calls. Same isolation pattern as
// knowledgeClient.ts: reuses the shared fetch helpers without touching them.
import { getJson } from "./client";
import type { PreinjectPreviewResult } from "@/protocol/chatEntry";

export type { PreinjectPreviewFile, PreinjectPreviewResult } from "@/protocol/chatEntry";

/** Composer preview: the same workspace scan (and token pricing) a first
 *  message sent with this agent would trigger. Persists nothing. */
export function previewContextFiles(agentId: string): Promise<PreinjectPreviewResult> {
  return getJson(
    `/api/context-injection/preview?agentId=${encodeURIComponent(agentId)}`,
  ) as Promise<PreinjectPreviewResult>;
}

/** Every candidate found on disk, agent gating ignored — the source list for
 *  the per-message attach picker (`overrides.contextFiles`). */
export function previewAllContextFiles(): Promise<PreinjectPreviewResult> {
  return getJson("/api/context-injection/preview?all=1") as Promise<PreinjectPreviewResult>;
}
