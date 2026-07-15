# Coding tools plan — writes + governed exec

Status: IMPLEMENTED 2026-07-15.

## Why

Runvane agents can already *act* — the tool-host exposes `exec` (full `bash -lc`
with streamed output + cancel) and `curl`, registered as proxies at boot. Two
seams keep it from being a daily coding driver:

1. **No first-class file writing.** The tool-host's `filesystem` tool has a
   `write_file` op, but the safety rule in `tool-host.service.ts` skips any host
   proxy whose name collides with a builtin — so the read-only `filesystem`
   builtin wins and writes are unreachable as a tool. Agents can only edit by
   shelling heredocs/`sed` through `exec`: quoting hell, no diff, opaque to the
   approval flow.
2. **`exec` has no rules.** `HostToolProxy` advertises an empty rules schema, so
   the only governance is the per-agent×tool policy (off/ask/allow). "Ask" on
   every command is noise; "allow" is a blank cheque. No command allowlist, no
   working directory.

## What we build

### 1. Filesystem builtin gains write_file + edit_file

Extend the existing safety-bearing `filesystem` builtin (single dispatch on
`operation`), keeping reads exactly as they are:

- `write_file` — `{ path, content }`. Creates parent dirs, writes UTF-8,
  reports `created` vs overwritten and byte counts.
- `edit_file` — `{ path, old_string, new_string, replace_all? }`. Exact-string
  replace; errors if `old_string` is absent, or ambiguous (appears >1× and
  `replace_all` not set). Returns a unified diff of the change for the
  transcript row — the surgical shape is the whole value of an edit tool.

**Safety without weakening the shadow rule.** Writes are gated by a NEW rule,
`writable_roots` (default `[]`), resolved by the same canonical-realpath
containment check reads use against `allowed_roots`. Reads stay on
`allowed_roots`; writes require an explicit writable root, so enabling the
filesystem tool never implicitly grants writes — an agent owner opts in by
adding a root. Per-agent policy (ask/allow) is orthogonal and unchanged.

Runs harness-local, exactly like the existing read ops (the builtin already
executes in-process and is labelled `target`; on the default harness-host
sandbox that IS the target). Cross-machine writes for ssh sandboxes are the
same pre-existing limitation as cross-machine reads — noted, not solved here.

The in-repo tool-host `filesystem` tool gains a matching `edit_file` op so a
future un-shadowed sandbox path stays behavior-compatible; it already had
`write_file`.

### 2. Exec becomes a governed proxy (rules profile)

Rather than a new builtin class in `ToolsModule` needing `ToolHostService`
(a module cycle — `ToolHostModule` imports `ToolsModule`), give `HostToolProxy`
an optional **rules profile** that `ToolHostService` attaches to specific host
tools by name at registration. This keeps exec routing/streaming/cancel through
the tool-host unchanged, lives entirely in `ToolHostModule`, and makes the exec
proxy safety-bearing (a real rules + permission schema) — consistent with the
shadow rule's intent instead of fighting it.

The `exec` profile (`tool-host/exec-rules.ts`):

- Rules: `allowed_prefixes: string[]` (default a conservative read-only set:
  ls/pwd/cat/head/tail/grep/rg/git status|diff|log|show|branch/wc/stat/file/
  echo/whoami/date/`node --version`/`npm --version`), `ask_outside_allowlist`
  (default true), `default_cwd` (default "").
- `getDefaultPolicy()` → `custom`, so the allowlist governs out of the box.
- `evaluatePermission`: sandbox `none` → forbid; a command that matches an
  allowed prefix on a word boundary AND contains no shell control operators
  (`; && || | \` $( > < & newline`) → allow; else → ask_user (or allow when
  `ask_outside_allowlist` is false). The operator check closes the obvious
  `ls; rm -rf /` prefix-bypass — chained/redirected commands always prompt.
- `runTool` injects `default_cwd` into params when the model omitted `cwd`.

Only consulted under the `custom` policy (now the exec default); `off`/`ask`/
`allow` still resolve centrally, so an agent can force always-ask or always-run.

## Testing

- Unit (the real logic): filesystem write/edit ops incl. create-vs-overwrite,
  ambiguous-edit error, unified diff, and `writable_roots` gating (write outside
  a writable root rejected even when readable); exec prefix matching, word-
  boundary, shell-operator bypass rejection, `ask_outside_allowlist`, and
  default-cwd injection. Unit is the right home here per the repo's "unit only
  for really complex logic" rule — this is matcher/diff logic.
- Full suite (unit + integration + e2e) green; the change adds tools without
  touching seeded agent configs (no agent enables exec/filesystem-write), so
  existing tool e2e (11-tool-location, probes) is unaffected. Commit to main.

## Decisions

- **Writes are opt-in via `writable_roots`, not `allowed_roots`.** Enabling the
  filesystem tool for reads must never silently enable writes.
- **Exec stays a proxy** (rules profile), not a relocated builtin — same runtime,
  no module cycle, and it becomes safety-bearing so the shadow rule is satisfied.
- **Prefix allowlist is coarse by design**; the shell-operator guard + word
  boundary stop the cheap bypasses, and the agent owner curates prefixes. Not a
  sandbox — defense in depth on top of the actual sandbox boundary.
