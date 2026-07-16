// Context-injection (files) API calls. Same isolation pattern as
// knowledgeClient.ts: reuses the shared fetch helpers without touching them.
import { getJson } from "./client";
import type { PreinjectPreviewResult } from "@/protocol/chatEntry";

export type { PreinjectPreviewFile, PreinjectPreviewResult } from "@/protocol/chatEntry";

/** Every candidate discovered in the sandbox workspace with content + token
 *  pricing, agent gating ignored — the one source list for the Start context
 *  staging checkboxes and the per-message attach picker
 *  (`overrides.contextFiles`). Persists nothing. Scope with `conversationId`
 *  (the conversation's bound sandbox) or `toolSandboxId` (staging a new chat;
 *  server defaults to `local`). (The agent-gated variant, `?agentId=`,
 *  remains an API/e2e surface: it mirrors the automatic first-message scan.) */
export function previewAllContextFiles(scope: {
  toolSandboxId?: string;
  conversationId?: string;
}): Promise<PreinjectPreviewResult> {
  const params = new URLSearchParams({ all: "1" });
  if (scope.conversationId) params.set("conversationId", scope.conversationId);
  else if (scope.toolSandboxId) params.set("toolSandboxId", scope.toolSandboxId);
  return getJson(`/api/context-injection/preview?${params.toString()}`) as Promise<PreinjectPreviewResult>;
}
