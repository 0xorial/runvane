# Onboarding plan

Status: IMPLEMENTED 2026-07-14 (phases 1–3).

## Problem

Runvane's object model is clean — providers power everything, agents are who you
talk to, sandboxes are where tools act, RAG storages are what agents can look
up — but the UI never states it. Concretely:

- **Fresh install dead-ends.** With zero agents, `AgentCardsEmptyState` renders
  nothing (`{#if agents.length > 0}` wraps the whole component); the only
  signpost is a small toolbar link into settings, where creating an agent needs
  a provider that doesn't exist yet. The dependency chain is invisible and gets
  walked backwards.
- **Settings order fights setup order.** Flat sidebar: System, Model Providers,
  Model Presets, Model Pricing, Tools, RAG, Tool Sandboxes, Agents. Pricing (a
  nicety) precedes Tools; Agents is last; nothing says providers come first.
- **No at-a-glance state.** Nowhere shows "1 provider connected, 2 agents,
  1 storage, 3 sandboxes".
- **Good patterns exist but inconsistently.** Sandboxes have a role sentence +
  hint + inline creation at point of need (`AddSandboxDialog` on the new-chat
  screen); RAG has the "set up RAG ↗" link in the retrieval bar. Providers and
  agents have neither.

## Shape of the fix

Teach the model in three places, all state-driven (no one-shot wizard — cards
derived from live data age better and double as recovery UI):

1. a setup guide on the new-chat screen,
2. settings grouped by the object model with a role sentence per section and an
   overview landing,
3. no dead-ends: every missing-dependency surface explains and links (or
   creates inline).

## Phase 1 — setup guide on /chat/new

New `SetupGuide.svelte` rendered by `AgentCardsEmptyState`:

- **Auto** when the core chain is broken: `agents.length === 0` or no provider
  with `models_verified && models.length > 0`.
- **On demand** via `?setup=1` (dismiss returns to the agent cards). This keeps
  the guide reachable later and makes it e2e-testable against the seeded stub
  state without mutating shared data.

Steps mirror the dependency graph. Every step stays expandable when done
(check mark ≠ locked): the guide doubles as a quick-actions hub.

1. **Connect a model provider** — provider rows from `LlmSettings` (registry
   auto-seeds one row per known provider type). Expanding a row shows its
   `settings_spec` fields (api key, base url) inline + Test connection; on
   success the document is saved (PUT) and the step completes. No trip to
   settings.
2. **Create your first agent** — name + model picker (grouped by verified
   providers, first verified model preselected). `POST /api/agents` accepts
   `name` + `default_llm_configuration`, so one call creates a configured
   agent; it's made default when it's the first. On success, navigate into
   `?agent=<id>` so the composer is immediately usable.
3. **Optional, "for later" cards** — Sandbox (opens the existing
   `AddSandboxDialog`), RAG storage (links `/settings/rag`), each with its
   one-line role.

A short "how runvane fits together" line ties the four concepts (also used by
the settings overview).

State derivation lives in `frontend/src/lib/setupState.ts` (shared with
phase 2): `providersReady`, `agentsReady`, plus counts.

## Phase 2 — settings that carry the object model

- **Grouped sidebar** (slugs unchanged — e2e and bookmarks keep working;
  only visible labels/grouping change):
  - Overview (`overview`, new)
  - Models: Providers, Presets, Pricing
  - Agents: Agents
  - Execution: Tools, Sandboxes
  - Knowledge: RAG storages
  - System: System
- **Role sentence per section**, rendered by `SettingsSectionView` above each
  section (one map, one pattern), with cross-links: e.g. Providers — "Model
  sources. Agents, RAG storages and presets pick their models from here."
  Sandboxes/RAG keep their existing descriptions (folded into the same map to
  avoid duplication).
- **Overview landing** (`SettingsOverview.svelte`): the four-node dependency
  map with live counts (providers verified, agents, sandboxes, storages) and
  links; shows the setup-chain status from `setupState.ts` and links
  `/chat/new?setup=1` when incomplete.
- Bare `/settings` (no `?agent=`) now lands on `overview`
  (`DEFAULT_SETTINGS_SECTION`, `settingsLinkFromSearch` fallback).

## Phase 3 — dead-end elimination

Every surface where a missing dependency strands the user explains + links:

| Surface | Dead end today | Fix |
| --- | --- | --- |
| `ModelGroupSelect` (agent LLM, guardrail, system) | empty dropdown when no verified provider | inline "No verified models — connect a provider" + link `/settings/model-providers` |
| RAG create form | provider/model inputs with no suggestions | same hint under the embedding provider input when `modelsFor(providerId)` is empty |
| `ChatAgentToolbar` zero-agents note | links deep into settings | link `/chat/new?setup=1` (the guide handles provider + agent in order) |
| `AgentsEditor` zero agents | bare "Add agent" button | one-line empty state naming the prerequisite (provider) when providers aren't ready |
| Already fine | `RetrievalActionBar` ("set up RAG ↗"), cost display ("No pricing configured"), sandboxes (built-ins always exist) | — |

## Testing

- New `tests/e2e/21-onboarding.spec.ts`:
  - `?setup=1` renders the guide over the seeded state: step 1 done (stub
    verified), step 1 expandable → Test connection round-trips (idempotent
    re-verify), step 2 creates an agent through the guide UI (then deletes it
    via API to restore state).
  - `/settings` lands on Overview with live counts; grouped sidebar navigates;
    existing slugs still render their sections.
- Existing specs guard the slug stability (`/settings/rag`,
  `/settings/tool-sandboxes`, `/settings/agents?agent=…`, `/settings/system`)
  and the settings-from-chat path (`03-layout-parity` expects "Add agent"
  after `open-settings` with an agent param — unchanged).
- Full suite + `tsc --noEmit` + `svelte-check` per phase; commit per phase.

## Decisions

- **No modal wizard.** The guide is a state-driven surface in the empty
  transcript area; it disappears when the chain is complete and reappears if
  it breaks (e.g. all agents deleted).
- **Steps never lock.** Done-ness is a badge, not a gate — the same UI serves
  first-run and recovery.
- **Slugs are stable.** Regrouping changes labels and order only.
- **Zero-state e2e realism.** The suite's seeded DB always has a verified stub
  provider + agents; the guide is exercised via `?setup=1` and idempotent
  actions instead of destructive state resets.
