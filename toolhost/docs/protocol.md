# Tool-host wire protocol (v1)

The brain and a tool-host exchange JSON messages over a **duplex byte stream**.
The protocol is transport-agnostic: the same messages flow over an in-process
channel, a child process's stdio, or an ssh channel.

## Framing

**NDJSON** — one JSON object per line, terminated by `\n`. A transport just has
to deliver a duplex byte stream; framing turns it into a stream of messages.
(An HTTP+SSE transport would carry the same objects as SSE events + POSTed
messages — equivalent, not yet implemented.)

## Messages

Every message has a `type`. See [`src/protocol/messages.ts`](../src/protocol/messages.ts).

### brain → host

| type | fields | meaning |
| --- | --- | --- |
| `hello` | `protocolVersion` | sent once on connect |
| `list_tools` | `requestId` | ask for the host's tool catalog |
| `invoke` | `invocationId`, `sessionId`, `toolName`, `params` | start a tool run |
| `cancel` | `invocationId` | abort an in-flight run (→ `AbortSignal`) |
| `ping` | `nonce` | liveness / round-trip timing |

### host → brain

| type | fields | meaning |
| --- | --- | --- |
| `ready` | `protocolVersion` | host is up and listening |
| `tools` | `requestId`, `tools[]` | reply to `list_tools` |
| `progress` | `invocationId`, `delta` | streamed stdout/partial output (→ `onProgress`) |
| `result` | `invocationId`, `ok`, `output`, `error`, `timing` | final outcome |
| `pong` | `nonce` | reply to `ping` |
| `error` | `invocationId\|null`, `message` | host-level / protocol error |

## Lifecycle

```
brain                              host
  | --------------- hello ------------> |
  | <-------------- ready ------------- |
  | ------------- list_tools ---------> |
  | <-------------- tools ------------- |
  |                                     |
  | -------------- invoke ------------> |   run starts (AbortController per id)
  | <------------ progress ----------- |   (0..n, streamed)
  | <------------ progress ----------- |
  | <------------- result ------------ |   run settles, controller dropped
  |                                     |
  | -------------- invoke ------------> |
  | -------------- cancel ------------> |   signal aborts → process killed
  | <------------- result ------------ |   ok:false, error:"aborted"
```

## Sessions

`invoke` carries a `sessionId`. For now there is a single `"local"` session per
host. The field exists so a host can later isolate per-chat state (separate
cwd, env, long-lived shells) without a protocol change — start single, go
per-chat by minting more session ids.

## Tool partition (brain vs runtime)

A tool's **location** decides where it runs and never changes per call:

- `runtime` tools (this host): `exec` and `filesystem` (one tool, dispatched on
  `operation`: read_file / write_file / list_dir / stat). They touch the sandbox.
- `brain` tools (never cross the wire): `rag`, `conversations`, `api`.
  They touch central state. RAG indexes live with the brain and carry a lot of
  retrieval configuration, so RAG stays a brain tool by design.

The brain merges its native brain tools with one proxy per host tool (from
`list_tools`). `TOOL_LOCATION_META` gives the UI an accent + icon so each tool
row shows where it ran.

## Monitoring & cancellation

`invoke`/`progress`/`result` map 1:1 onto runvane's `ToolRunContext`
(`signal` + `onProgress`). The brain runs each host-tool proxy inside
`taskRegistry.run(...)` exactly as it does local tools, so:

- the run appears in **running-tasks monitoring**, and
- cancelling that task aborts the signal → client sends `cancel` → host kills
  the real process.

`ToolHostClient` also accepts an optional `InvocationReporter`
(`onInvocationStart/Progress/End`) for monitors that want a direct hook.
