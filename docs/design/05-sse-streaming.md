# Layer 3 — SSE streaming

**The choice.** Live UI is driven by **Server-Sent Events**, structured as
**snapshot + live tail** gated by a **single global monotonic sequence number**.
Two events do almost all the work (`CHAT_ENTRY_UPSERT`, `CHAT_ENTRY_DELTA`). There
is **no replay buffer** and no client/server seq negotiation — recovery from any
gap is a fresh snapshot. On the client, **one multiplexed connection** serves the
whole app.

This sits under the DAG (it streams DAG mutations) and under the thought pipeline
(which produces them). It's the transport that makes "orchestrate transparently"
(§0.3) *visible* in real time.

Sources: `contracts/sse.ts`, `sse/sse-hub.service.ts`,
`db/stream-cursor.service.ts`, `conversations/conversations.controller.ts:268-311`,
`frontend/src/protocol/runLiveClient.ts`, `ARCHITECTURE.md:144-157`.

---

## Two events carry the state; the rest are notifications

`ARCHITECTURE.md:146-157`:

- **`CHAT_ENTRY_UPSERT { entry }`** — a full snapshot of one entry, sent on create
  and on every non-streaming update (status change, decision persisted, tool
  settled). The receiver upserts by id.
- **`CHAT_ENTRY_DELTA { chatEntryId, field, delta }`** — an append-only string
  delta to one text field (`llmResponse`, `thinkingText`, assistant `text`). This
  is the token-by-token streaming path.

Everything else (`USER_MESSAGE`, `TOOL_INVOCATION_START/END/PROGRESS`,
`CONVERSATION_UPDATED`, `MESSAGE_ENQUEUED/DEQUEUED`) is a *notification* that
doesn't itself mutate chat-entry state. Crucially: **there is no per-step lifecycle
event** — status transitions ride `CHAT_ENTRY_UPSERT` of the underlying entry
(`ARCHITECTURE.md:155-157`). Fewer event types = fewer ways for client and server
to disagree.

All 11 event shapes are one Zod `discriminatedUnion` (`SsePayloadSchema`,
`sse.ts:137-150`), and the hub validates every frame against it before publishing
(`sse-hub.service.ts:15-24`) — Layer 1 applied to the bus itself.

## The watermark: one number does the snapshot↔stream handoff

A single global monotonic counter (`stream_cursor`, one row `id=0`) is **bumped in
the same transaction as every `chat_entries` mutation**, so its value *is* both the
event `seq` and the snapshot watermark (`schema.prisma:161-170`).

- **Live events** are stamped with the cursor's current value from a cheap
  in-memory mirror (`StreamCursorService.current()`,
  `stream-cursor.service.ts:34-37`) — no per-event DB read.
- **Snapshots** read the DB cursor *inside the same read transaction as the
  entries*, so the watermark exactly matches the entries returned
  (`stream-cursor.service.ts:4-15`, `sse-hub.service.ts:36-43`).

The client baselines on the snapshot's `seq = W` and applies later frames only when
`seq > W`. That's the entire ordering protocol:

> "This single watermark IS the snapshot↔stream handoff — there is deliberately no
> replay buffer: recovery from any gap is a fresh snapshot."
> — `sse-hub.service.ts:30-35`

## Why no replay buffer

A replay buffer means the server must remember every event since some client's last
ack, negotiate sequence ranges, and evict carefully. Runvane sidesteps all of it:
if a client falls behind or reconnects, it just re-fetches the snapshot (which
carries a fresh `W`) and resumes the tail after it. The cost is re-sending a
snapshot on reconnect; the saving is an entire class of buffer-management and
seq-negotiation bugs. This is the same "derive, don't remember" instinct as Layer 1
— the DB can always reproduce the truth, so don't cache a fragile approximation of
it in the hub.

## The per-conversation stream orders snapshot-before-tail carefully

The controller subscribes to the live tail **first**, buffers those frames, then
reads and emits the snapshot, then flushes the buffer — so nothing slips through
the gap between "read snapshot" and "start listening":

```
// conversations.controller.ts:276-309 (paraphrased)
subscribe live tail → buffer until snapshot sent
read snapshot (entries + watermark seq) → emit as first frame
flush buffered live frames
```

The snapshot frame also carries `leafId` + `anchorId` so a fresh SSE connection
seeds the same branch view a page reload would (`sse.ts:72-80`,
`controller:291-301`). A memory note records that these snapshot fields must be set
in the *initial insert*, not merged later, or the snapshot throws and kills the
stream — a real past bug.

## Client: one multiplexed connection for the whole app

`frontend/src/protocol/runLiveClient.ts` maintains a **single global
`EventSource`** with a `Set` of subscribers, not one connection per view. Design
points:

- The last-seen seq is persisted to `localStorage` and passed as `?after_seq=` on
  (re)connect (`runLiveClient.ts:113-117`), so a reconnect resumes rather than
  replays from zero.
- A layered recovery ladder: on error, schedule bounded recovery checks; if the
  `EventSource` stays closed past a threshold, fall back to **HTTP polling** via
  registered `onPollTick`s (`runLiveClient.ts:81-159`). SSE is the fast path;
  polling is the safety net.

> **Why one connection matters (memory):** browsers cap ~6 concurrent HTTP/1.1
> connections per origin. An earlier design opened ~3 SSE streams *per tab*; two
> tabs (6 streams) exhausted the cap and starved every other request. The single
> multiplexed stream is the fix. Don't reintroduce per-view SSE connections.

## What it forbids

- **No new lifecycle/reload event types.** Express a change as an `UPSERT`/`DELTA`
  of the affected entry (`ARCHITECTURE.md:201-203`, invariant #5).
- **No replay buffer / seq negotiation.** Reconnect = fresh snapshot.
- **No per-view SSE connections on the client.** Subscribe to the shared stream.
- **No emitting an entry over SSE whose mapper-required fields aren't persisted
  yet** — the snapshot must be able to re-serialize it.
