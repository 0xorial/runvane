import type { RunvaneRuntimeConfig } from './runtime.config.js';

export const RUNVANE_RUNTIME = Symbol('RUNVANE_RUNTIME') as symbol & {
  readonly __type: RunvaneRuntimeConfig;
};
