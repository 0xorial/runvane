# Dev port allocation

Each project gets a **3-digit base** and **100 ports**: `base * 100` through `base * 100 + 99`.

Example: base `522` → `52200-52299`.

## Register a project

1. Pick an unused base in `registry.json`:

```json
{
  "my-app": { "base": 523, "dir": "my-app" }
}
```

2. Add `dev-ports.json` in the project root (optional if registered):

```json
{ "project": "my-app" }
```

Or inline the base:

```json
{ "base": 523 }
```

## Default slots (`slots.json`)

| Slot | Offset | runvane (522) |
|------|--------|---------------|
| backend | 0 | 52200 |
| frontend | 1 | 52201 |
| backendDebug | 2 | 52202 |
| frontendPreview | 3 | 52203 |
| prismaStudio | 4 | 52204 |

Override per project in `dev-ports.json`:

```json
{ "project": "my-app", "slots": { "frontend": 5 } }
```

## Commands

```bash
# List all projects and resolved ports
node dev-ports/list.mjs

# Write .env.ports for docker compose (from nearest dev-ports.json)
node dev-ports/sync-env.mjs

# Run a command with port env vars injected (auto-detects project from cwd)
node dev-ports/with-ports.mjs --cwd runvane/backend -- npm run dev
node dev-ports/with-ports.mjs --cwd runvane/frontend -- npm run dev
```

`npm run dev` in backend/frontend already wraps `with-ports.mjs`.

Sets: `PORT`, `BACKEND_PORT`, `FRONTEND_PORT`, `FRONTEND_ORIGIN`, `VITE_API_BASE_URL`, `DEV_PORT_BASE`.

To change ports for a project, edit `base` in `registry.json` only — nothing else should hardcode port numbers.
