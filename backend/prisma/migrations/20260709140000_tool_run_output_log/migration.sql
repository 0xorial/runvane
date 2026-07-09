-- Persist the tool's streamed progress log per execution attempt, so the
-- details panel can show run logs after completion (they were previously
-- transient SSE deltas only). Additive by hand — see repo migration policy.
ALTER TABLE "tool_runs" ADD COLUMN "output_log" TEXT;
