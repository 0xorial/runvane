# Runvane Deployment Notes

This doc focuses on the "ops hardening" layer: logs, metrics, and safe execution defaults.

## Logs

The backend emits structured JSON logs to stdout/stderr.

Correlation:

- `request_id`: provided by `X-Request-Id` header (or generated automatically)
- `run_id`: set when a run is created and used for tool/policy/approval logs

Env:

- `RUNVANE_LOG_LEVEL` (default `INFO`)

## Metrics

Backend exposes:

- `GET /metrics`

Currently returns a JSON snapshot with:

- uptime
- in-memory counters for tool invocations/success/failure/circuit-open

## Retry + Circuit Breaker

Tool invocation is wrapped with:

- retries per tool (`ToolSpec.retries`)
- a per-tool circuit breaker after consecutive failures

Env:

- `RUNVANE_CB_FAILURE_THRESHOLD` (default `3`)
- `RUNVANE_CB_RESET_SEC` (default `60`)

## Redaction

Before tool results are stored in traces/UI/logs, Runvane performs best-effort redaction for:

- bearer tokens
- `sk-...`-style secrets
- private key blocks

Pending tool inputs (used after approval) are not redacted so execution still works.
