# Layer 3 — Tools, permissions & fan-in

**The choice.** Tools are plug-ins behind one `BaseTool` abstract class in a
**collision-proof registry**. Permission is a **per-agent × per-tool policy**
resolved centrally, with an optional per-tool dynamic evaluator and an optional
**guardrail LLM**. A tool call's whole lifecycle is a single pre-created chat entry
that later phases *update in place*, while an immutable `tool_runs` table records
each attempt. Whether the planner resumes after a batch is **derived from history**
(Layer 1), not counted in memory.

Sources: `tools/base-tool.ts`, `tools/tool-registry.ts`,
`tools/run-tool.service.ts`, `tools/toolParamEnvelope.ts`,
`contracts/guardrail.ts`, `schema.prisma:172-199`, `ARCHITECTURE.md:78-84`.

---

## `BaseTool`: one abstraction, many surfaces

`tools/base-tool.ts:51-94` defines what every tool must provide. The interesting
design is that a tool's **params schema is Zod**, and that one schema feeds three
consumers (Layer 1's "one artifact, three surfaces"):

- `getParamsSchema()` → JSON Schema advertised to the **LLM**.
- `getRulesSchema()` → a `zerialize`d Zod schema shipped to the **client** for form
  rendering (`dezerialize`d there).
- `parseParams()` / `parseRules()` → runtime validation at execution.

A tool also declares:

- `getDefaultPolicy()` → defaults to the safe `ask`; read-only tools override to
  `allow` (`base-tool.ts:63-70`). Safety is the default, permissiveness is opt-in.
- `getLocation()` → `harness` (central, default) vs `target` (runs in the
  sandbox/tool-host) — the routing hook for the tool-host split
  (`base-tool.ts:15`, `:86-93`).
- `evaluatePermission()` → per-call dynamic policy, consulted **only** when the
  agent sets this tool to `custom` (`base-tool.ts:72-82`).

## The registry refuses silent replacement

`ToolRegistry.register` throws on a name collision, and the comment states the
safety invariant plainly:

> "a tool-host proxy (which carries no rules/permission schema) must not be able to
> silently supersede a safety-bearing builtin like `filesystem`."
> — `tools/tool-registry.ts:14-25`

A missing/duplicate name is a startup crash, not a last-registration-wins surprise
(§0.1).

## Permission resolution: policy first, evaluator second

`ToolPolicy` is `off | ask | allow | custom` (`base-tool.ts:5-13`). Resolution is
central in `RunToolService`:

- `off` → unavailable (not advertised; denied if called).
- `ask` → prompt the user (creates a `requested` entry awaiting approval).
- `allow` → run without prompting.
- `custom` → defer to the tool's `evaluatePermission`, whose rule results are
  combined **most-permissively** (`mostPermissivePermission`, `base-tool.ts:96-109`)
  — but note an empty rule set means `forbid`, i.e. "no opinion" fails safe.

## The guardrail LLM

Independently of policy, an agent can attach a **guardrail** — a separate LLM cycle
(the `guardrail` thoughtType) that inspects a proposed tool call and can force it to
"needs approval." The default prompt is a security-review policy shared between
backend and the settings UI so the two can't drift (`contracts/guardrail.ts:1-25`,
Layer 1 reuse). When it flags a call, the run is blocked with a guardrail-tagged
reason surfaced in the UI (`run-tool.service.ts:56-60`).

## One entry, many phases; one row per attempt

A tool invocation is represented twice, on purpose (`schema.prisma:172-199`):

- The **`tool-invocation` chat entry** is the *transcript surface*, mutated in place
  as it moves `resolving → requested → running → done/error/denied`
  (`ToolStateSchema`, `contracts/chatEntry.ts:213`). Params resolution, guardrail,
  approval and execution all update this one row — which is why the batch's chain
  shape is fixed at dispatch (Layer 3 DAG).
- The **`tool_runs` table** is the *immutable per-attempt audit* and the base for
  retries: one row per execution attempt, with `attempt`, `retry_of_run_id`,
  parameters, result, error, and a tail-capped `output_log`.

The user-edit and retry flows preserve honesty in the transcript: if the user edits
params before approving, the entry keeps `originalParameters` + a `parametersEdited`
flag so "the transcript must make obvious that the executed call differs from the
requested one" (`contracts/chatEntry.ts:216-233`; approve-edit path
`run-tool.service.ts:230-236`).

## Fan-in: resume from the DAG, not a counter

Covered in [Layer 1](02-state-is-derived.md) but it lives here: the planner
continues once the batch has **zero** tools still `requested`/`running`, decided by
querying chat history; a per-conversation lock only serializes the check
(`run-tool.service.ts:80-85`, `:728-735`). Denials and failures count as
resolutions. A user retry deliberately bypasses the "already continued" guard to
create a sibling branch at the tail (`run-tool.service.ts:48-52`,
`ARCHITECTURE.md:82-84`).

## The tool-param envelope (a sharp, well-documented gotcha)

Runvane stamps internal bookkeeping keys (`tool_request`, `tool_note`, `source`,
`__tool_batch`) onto a stored invocation's `parameters`. These must be **stripped**
before params flow into a tool's strict schema or back into an LLM context. The
comment records *why*, with a real incident:

> "Models imitate whatever argument shape their context shows: a glm-5.2 run once
> looped through 15 silent planning rounds because it echoed these keys from
> replayed context turns and the strict param schema rejected every dispatch."
> — `tools/toolParamEnvelope.ts:1-10`

`withToolNoteProperty` advertises an optional `tool_note` display slot to the
planner; `stripToolParamEnvelope` is its inverse so the note never reaches the tool
(`toolParamEnvelope.ts:11-45`). This is §0.2 boundary discipline in miniature:
sanitize exactly at the tool boundary, trust the shape inside.

## What it forbids

- **No last-wins tool registration.** Unique names or crash.
- **No permissive default.** New tools are `ask` unless read-only.
- **No leaking envelope keys** into tool schemas or LLM context.
- **No in-memory batch scoreboard** as the source of truth for continuation.
