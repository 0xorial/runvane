# Chat tool overrides — implementation plan

Per-chat tool policy UI that overrides agent settings for the current turn. Overrides are versioned on each user message.

## UI layout

Split the left `ResizableSidePanel` vertically:

```
┌─────────────────────┐
│ Recent conversations │  scroll, existing list (trimmed)
├─────────────────────┤
│ Chat tools           │  fixed footer (~40% max height)
│  filesystem  [off|all|custom]
│  bash        [off|all|custom]
│  ...                 │
│  [Reset to agent defaults]
└─────────────────────┘
```

### Per-tool tri-state (segmented control)

| Mode | Color | Persisted meaning |
|------|-------|-------------------|
| **Off** | Gray | `{ enabled: false }` |
| **Allow all** | Red/orange | `{ enabled: true, rules: { allowed: 'always' }, guardrail: false }` |
| **Custom** | Green | Full `AgentToolConfig` (rules JSON + guardrail toggle/prompt) |

- **Custom** opens the **right panel** (reuse branches slot or dedicated sheet) with the same editors as agent settings (`ZodJsonEditor` + guardrail fields).
- Extract a shared `ToolConfigEditor` from `AgentsEditor` so agent config and chat custom mode stay in sync.
- Optional later: per-tool ↺ reset on each row (same as setting that tool to inherit).

### Reset to agent defaults

- Ghost/secondary button at the bottom of the Chat tools panel.
- Clears the **draft** only — all tools return to **inherit**; nothing written to `overrides.tools` on the next send unless the user changes a tool again.
- Does **not** rewrite history; already-sent messages keep their stored overrides.
- Closes the custom editor panel and clears `selectedToolForEdit`.
- Optional confirm when custom edits exist: “Discard chat tool overrides?”
- After reset: no segment selected, or muted label “Using agent defaults”.

## Persistence model

### Store on user message (recommended)

Add optional `overrides` to `user-message` entries and `POST /api/conversations/:id/messages`.

```ts
overrides?: {
  version?: 1;
  tools?: Record<string, AgentToolConfig>; // same shape as agent.entity AgentToolConfig
  // future: guardrail?, llm?, modelPresetId?, system prompt patch, etc.
}
```

**Why message-level, not conversation-level:**

- Each branch carries its own policy (time-travel / reprocess fidelity).
- Audit: “what policy was active when I sent this?”
- Reprocess of message M replays `M.overrides` exactly.

**Do not persist UI mode** (`off` / `allow_all` / `custom`). Compile to resolved `AgentToolConfig` at send time. Derive UI mode when rendering history from stored config.

| UI mode | `overrides.tools[name]` at send |
|---------|----------------------------------|
| Inherit | omit key |
| Off | `{ enabled: false }` |
| Allow all | `{ enabled: true, rules: { allowed: 'always' }, guardrail: false }` |
| Custom | full user-edited `AgentToolConfig` |

### Draft vs snapshot (hybrid)

| Layer | Where | When |
|-------|-------|------|
| **Draft** | React chat session state | While composing |
| **Snapshot** | `user-message.overrides` | On send (incl. steer / enqueue) |

Flow:

1. Open chat → seed draft from latest user-message on the active branch; else agent defaults.
2. User toggles tools → update draft only.
3. Send → `POST` includes `overrides: compile(draft)` → stored on new user-message.
4. Switch branch → re-seed draft from that branch’s latest user-message.
5. Reset to agent defaults → clear draft to inherit.

## Runtime

Overrides on user message **N** apply only to processing **started by N** (planner, tool-params, guardrail, `runTool`). Not retroactive.

### Merge order

1. Agent `default_llm_configuration.tools[tool]`
2. User-message `overrides.tools[tool]` if key present (shallow merge on `AgentToolConfig`)
3. Tool catalog `getDefaultRules()` for missing rule fields only

If `overrides.tools[tool]` is absent → full inherit from agent.

### Backend touchpoints

1. `UserMessageEntrySchema` + `appendUserMessage` payload
2. `PostConversationMessageRequestSchema.overrides` (optional; copied onto entry)
3. `ConversationProcessorService.startThoughts` — load overrides for `userMessageId`, attach to thought context
4. New helper: `resolveToolConfig(agent, userMessage, toolName)`
5. `RunToolService` — use merged config instead of agent-only
6. `plannerProvider` guardrail path — per-tool `guardrail_system_prompt` from merged config
7. SSE `USER_MESSAGE` includes overrides for UI consistency

Today `RunToolService` loads only agent config (`agent?.default_llm_configuration?.tools?.[toolName]`).

## Right panel (custom mode)

- `selectedToolForEdit` in chat session state.
- Right `ResizablePanel` shows `ToolConfigEditor` bound to **draft**, not agent settings.
- Closing panel keeps draft; send persists it.
- Branches panel and tool editor can share the right panel (tabs or auto-switch when custom is selected).

## Avoid

- Conversation-level `tool_overrides` column (second source of truth; branch ambiguity).
- Storing only UI tri-state without resolved `AgentToolConfig`.
- Applying overrides globally to the whole conversation instead of per triggering user-message.

## Implementation order

1. Contract + storage (`overrides` on user-message, POST field)
2. `resolveToolConfig()` + wire into `RunToolService` and planner guardrail
3. Extract shared `ToolConfigEditor` from settings
4. Left sidebar split + tri-state controls + draft state
5. Right panel for custom edit
6. Send path: compile draft → overrides
7. Reset to agent defaults button

## Related work

- **Enqueue** (in progress): `enqueue` on POST is orthogonal; overrides ride on the same POST body as `steer` / `enqueue`.
- **Chat tool** (`meta` / `chat` builtins): runtime introspection; separate from this policy UI.
