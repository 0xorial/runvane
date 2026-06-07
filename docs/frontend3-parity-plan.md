# Frontend3 (Svelte) — feature parity plan

Svelte 5 + Vite rewrite targeting the same Playwright e2e suite as `frontend/`.
Tests rely on `data-testid` and `data-chat-entry-*` attributes — keep those stable.

## Stack

| Layer | Choice |
|-------|--------|
| UI | Svelte 5 (runes) |
| Build | Vite 8 |
| Routing | Thin history router (`src/lib/router.ts`) |
| Server state | `@tanstack/svelte-query` |
| Session / transcript | Ported `ChatSessionStore` + SSE (`runLiveClient`) |
| Styles | Tailwind (shared tokens from frontend) |
| Port | `dev-ports` slot `frontend3` (base×100+5) |

## Phases

### Phase 1 — E2E green: probe + parallel chats (in progress)

- [x] Project scaffold, dev-ports slot `frontend3` (:52205), shared TS libs
- [x] `/chat/new`, `/chat/:id` routing
- [x] Sidebar: new chat, probe button, conversation list (flat; virtualize in phase 3)
- [x] Chat transcript rows with e2e `data-*` attrs
- [x] Composer with `chat-user-input` / `chat-send-button`
- [x] SSE + `createChatSessionState` (Svelte runes)
- [x] E2E: `E2E_FRONTEND_DIR=frontend3` + `playwright.frontend3.config.mjs`

**Tests:** `02-parallel-chats.spec.ts` ✅ · `01-probe-time.spec.ts` ❌ (also fails on React on this branch — stub/transcript timing)

### Phase 2 — Core chat UX

- [ ] Thought triplet rows (stream + action grouped under prepare)
- [ ] Branch selectors + `ConversationBranchesPanel`
- [ ] Optimistic user messages + `?isNew=true` navigation
- [ ] Token/cost badge in header (`ChatTitlePanel`)
- [ ] Task status button + running indicator
- [ ] Message enqueue chips + steer/send-while-running

### Phase 3 — Sidebar polish

- [ ] Groups (collapse, move, create)
- [ ] Multi-select, soft delete, restore
- [ ] Rename, context menus
- [ ] Selection highlight without full list re-render

### Phase 4 — Settings

- [ ] Settings layout + sidebar nav
- [ ] Agents, model providers, presets, tools, model pricing editor
- [ ] Theme toggle, error inbox

### Phase 5 — Terminal & playground

- [ ] Resizable terminal panel (xterm)
- [ ] Right activity sidebar
- [ ] Components playground (optional / last)

## Shared code strategy

Copy TypeScript modules from `frontend/src` that have no React deps:

- `api/client.ts`, `protocol/*`, `lib/chatSession*`, `lib/linkedChatEntry.ts`,
  `lib/observable*.ts`, `utils/chatEntries.ts`

Re-implement UI in Svelte; do not port React components line-for-line.

## Running

```bash
cd frontend3 && npm install && npm run dev   # http://localhost:52205
cd frontend3 && npm run test:e2e             # uses shared e2e/ via symlink
```
