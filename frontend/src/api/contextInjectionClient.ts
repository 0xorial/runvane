// Context-injection (files) API calls. Same isolation pattern as
// knowledgeClient.ts: reuses the shared fetch helpers without touching them.
import { getJson } from "./client";
import type { PreinjectPreviewResult } from "@/protocol/chatEntry";

export type { PreinjectPreviewFile, PreinjectPreviewResult } from "@/protocol/chatEntry";

/** Every candidate found on disk with content + token pricing, agent gating
 *  ignored — the one source list for the Start context staging checkboxes and
 *  the per-message attach picker (`overrides.contextFiles`). Persists nothing.
 *  (The agent-gated variant, `?agentId=`, remains an API/e2e surface: it
 *  mirrors exactly what the automatic first-message scan would inject.) */
export function previewAllContextFiles(): Promise<PreinjectPreviewResult> {
  return getJson("/api/context-injection/preview?all=1") as Promise<PreinjectPreviewResult>;
}
