import type { LlmProviderRow } from "../../../backend/src/contracts/settings";

/**
 * The core setup chain, derived from live data (never stored): runvane is
 * usable once at least one provider has a verified model list and at least
 * one agent exists. The setup guide (new-chat empty state) and the settings
 * overview both read this, so "what's missing" is answered the same way
 * everywhere.
 */

export function verifiedProviders(providers: LlmProviderRow[] | null | undefined): LlmProviderRow[] {
  return (providers ?? []).filter((p) => p.models_verified && p.models.length > 0);
}

export function providersReady(providers: LlmProviderRow[] | null | undefined): boolean {
  return verifiedProviders(providers).length > 0;
}

export function setupChainComplete(
  providers: LlmProviderRow[] | null | undefined,
  agentCount: number,
): boolean {
  return providersReady(providers) && agentCount > 0;
}
