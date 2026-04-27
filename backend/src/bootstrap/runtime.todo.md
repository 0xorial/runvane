## TODO: Split oversized runtime module

- `backend/src/bootstrap/runtime.ts` exceeds the 350-line limit and now mixes initialization, message orchestration, reprocess wiring, and approval/cancel handlers.
- This increases coupling and makes safe iteration harder when wiring new thought-processing flows.
- Suggested split direction:
  - extract enqueue/reprocess orchestration into `runtime/messageFlow.ts`
  - keep bootstrap construction in `runtime.ts`
  - move tool-approval/cancel handlers into `runtime/toolApproval.ts`
