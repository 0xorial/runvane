ALTER TABLE model_capabilities
  ADD COLUMN cached_input_cost_per_1m REAL;

ALTER TABLE model_capability_overrides
  ADD COLUMN cached_input_cost_per_1m REAL;
