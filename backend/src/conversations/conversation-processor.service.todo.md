# conversation-processor.service.ts — file length

- **Issue**: 372 lines, over the 350-line cap.
- **Why it matters**: oversized services are harder to navigate; the
  attachment-summary orchestration just pushed it past the limit.
- **Suggested split**:
  - Extract `resolveSummarizeRange` (pure function) into
    `summarizeRange.ts` under `conversations/`.
  - Consider splitting reprocess endpoints (`startReprocessContext`,
    `startReprocessReason`, `reprocessUserMessage`) into a
    `ReprocessOrchestrator` service that holds its own beginRun + resolveLlmRef.
