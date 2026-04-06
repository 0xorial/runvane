import { useEffect, useRef, useState } from "react";
import type { PlannerLlmStreamEntry } from "../../protocol/chatEntry";
import { ThinkingRow } from "../../components/chat/rows/ThinkingRow";
import { Button } from "@/components/ui/button";

const STREAM_CHUNKS = [
  "Scanning provider contract and runtime boundaries across request validation, model resolution, provider registry lookup, and stream emission paths.\n",
  "Mapping current invariants: strict input at boundaries, no hidden normalization in domain logic, explicit persistence for recoverability, and deterministic fallback behavior.\n",
  "Enumerating migration steps: isolate transport details behind provider adapter, preserve shared stream callback contract, and keep processor provider-agnostic.\n",
  "Reviewing error surfaces: ensure failures remain visible to user, include enough structured context for diagnostics, and avoid duplicate logs outside entry points.\n",
  "Designing prompt composition strategy: deterministic sections, explicit delimiters, history windows, and clear task constraints to minimize provider-specific coupling.\n",
  "Planning test matrix: live stream happy path, partial stream interruptions, provider not found, invalid model, and timeout propagation into task failure state.\n",
  "Checking UI behavior expectations: thinking block expands while live, collapses on completion, supports bounded height, and keeps long traces scrollable without layout shifts.\n",
  "Drafting rollout plan: ship behind feature flag, compare logs before and after, verify no regression in task throughput, then remove flag after soak period.\n",
  "Assessing observability updates: first-token latency, total thinking duration, stream completion marker, and explicit failure action emitted through event hub.\n",
  "Finalizing recommendation: keep abstraction narrow, favor plain text prompt IO, retain strict schema validation, and document provider capability assumptions.",
  "Scanning provider contract and runtime boundaries across request validation, model resolution, provider registry lookup, and stream emission paths.\n",
  "Mapping current invariants: strict input at boundaries, no hidden normalization in domain logic, explicit persistence for recoverability, and deterministic fallback behavior.\n",
  "Enumerating migration steps: isolate transport details behind provider adapter, preserve shared stream callback contract, and keep processor provider-agnostic.\n",
  "Reviewing error surfaces: ensure failures remain visible to user, include enough structured context for diagnostics, and avoid duplicate logs outside entry points.\n",
  "Designing prompt composition strategy: deterministic sections, explicit delimiters, history windows, and clear task constraints to minimize provider-specific coupling.\n",
  "Planning test matrix: live stream happy path, partial stream interruptions, provider not found, invalid model, and timeout propagation into task failure state.\n",
  "Checking UI behavior expectations: thinking block expands while live, collapses on completion, supports bounded height, and keeps long traces scrollable without layout shifts.\n",
  "Drafting rollout plan: ship behind feature flag, compare logs before and after, verify no regression in task throughput, then remove flag after soak period.\n",
  "Assessing observability updates: first-token latency, total thinking duration, stream completion marker, and explicit failure action emitted through event hub.\n",
  "Finalizing recommendation: keep abstraction narrow, favor plain text prompt IO, retain strict schema validation, and document provider capability assumptions.",
  "Scanning provider contract and runtime boundaries across request validation, model resolution, provider registry lookup, and stream emission paths.\n",
  "Mapping current invariants: strict input at boundaries, no hidden normalization in domain logic, explicit persistence for recoverability, and deterministic fallback behavior.\n",
  "Enumerating migration steps: isolate transport details behind provider adapter, preserve shared stream callback contract, and keep processor provider-agnostic.\n",
  "Reviewing error surfaces: ensure failures remain visible to user, include enough structured context for diagnostics, and avoid duplicate logs outside entry points.\n",
  "Designing prompt composition strategy: deterministic sections, explicit delimiters, history windows, and clear task constraints to minimize provider-specific coupling.\n",
  "Planning test matrix: live stream happy path, partial stream interruptions, provider not found, invalid model, and timeout propagation into task failure state.\n",
  "Checking UI behavior expectations: thinking block expands while live, collapses on completion, supports bounded height, and keeps long traces scrollable without layout shifts.\n",
  "Drafting rollout plan: ship behind feature flag, compare logs before and after, verify no regression in task throughput, then remove flag after soak period.\n",
  "Assessing observability updates: first-token latency, total thinking duration, stream completion marker, and explicit failure action emitted through event hub.\n",
  "Finalizing recommendation: keep abstraction narrow, favor plain text prompt IO, retain strict schema validation, and document provider capability assumptions.",
  "Scanning provider contract and runtime boundaries across request validation, model resolution, provider registry lookup, and stream emission paths.\n",
  "Mapping current invariants: strict input at boundaries, no hidden normalization in domain logic, explicit persistence for recoverability, and deterministic fallback behavior.\n",
  "Enumerating migration steps: isolate transport details behind provider adapter, preserve shared stream callback contract, and keep processor provider-agnostic.\n",
  "Reviewing error surfaces: ensure failures remain visible to user, include enough structured context for diagnostics, and avoid duplicate logs outside entry points.\n",
  "Designing prompt composition strategy: deterministic sections, explicit delimiters, history windows, and clear task constraints to minimize provider-specific coupling.\n",
  "Planning test matrix: live stream happy path, partial stream interruptions, provider not found, invalid model, and timeout propagation into task failure state.\n",
  "Checking UI behavior expectations: thinking block expands while live, collapses on completion, supports bounded height, and keeps long traces scrollable without layout shifts.\n",
  "Drafting rollout plan: ship behind feature flag, compare logs before and after, verify no regression in task throughput, then remove flag after soak period.\n",
  "Assessing observability updates: first-token latency, total thinking duration, stream completion marker, and explicit failure action emitted through event hub.\n",
  "Finalizing recommendation: keep abstraction narrow, favor plain text prompt IO, retain strict schema validation, and document provider capability assumptions.",
];

function createInitialEntry(id: string): PlannerLlmStreamEntry {
  return {
    type: "planner_llm_stream",
    id,
    conversationIndex: 0,
    createdAt: new Date().toISOString(),
    llmRequest:
      "Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses. Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking t\nraces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.Plan implementation for a provider-agnostic LLM integration. Include boundaries, failure handling, observability, and a migration plan with explicit risk controls. Provide enough detail to validate UI behavior for long thinking traces and streamed partial responses.",
    llmResponse: "",
  };
}

export function ThinkingComponentPlayground() {
  const [entry, setEntry] = useState<PlannerLlmStreamEntry>(() =>
    createInitialEntry("playground-thinking-interactive")
  );
  const [chunkIndex, setChunkIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const startedAtMsRef = useRef<number>(Date.now());

  useEffect(() => {
    if (paused) return undefined;
    const isCompleted = chunkIndex >= STREAM_CHUNKS.length;
    if (!isCompleted) {
      const tickId = window.setTimeout(() => {
        const next = chunkIndex + 1;
        setChunkIndex(next);
        setEntry((current) => ({
          ...current,
          llmResponse: STREAM_CHUNKS.slice(0, next).join(""),
          ...(next >= STREAM_CHUNKS.length
            ? { thoughtMs: Math.max(1, Date.now() - startedAtMsRef.current) }
            : {}),
        }));
      }, 600);
      return () => window.clearTimeout(tickId);
    }
    const resetId = window.setTimeout(() => {
      setChunkIndex(0);
      startedAtMsRef.current = Date.now();
      setEntry(createInitialEntry("playground-thinking-interactive"));
    }, 1200);
    return () => window.clearTimeout(resetId);
  }, [chunkIndex, paused]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setPaused((v) => !v)}>
          {paused ? "Continue" : "Pause"}
        </Button>
      </div>
      <ThinkingRow entry={entry} />
    </section>
  );
}
