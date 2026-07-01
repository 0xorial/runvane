-- Ground-truth cost aggregate, distinct from the token-based estimate the
-- frontend computes from ModelCapability pricing. Only providers that report
-- cost directly in their response (e.g. OpenRouter's `usage.cost`) contribute
-- here, so this is exact when provider_cost_partial is 0 and a lower bound
-- when it's 1 (some billable turn's provider didn't report a cost).
ALTER TABLE "conversations" ADD COLUMN "provider_cost_total" REAL NOT NULL DEFAULT 0;
ALTER TABLE "conversations" ADD COLUMN "provider_cost_partial" BOOLEAN NOT NULL DEFAULT false;
