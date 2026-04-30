import { createAutoTitleThoughtTypeProvider, type AutoTitleThoughtTypeProviderDeps } from './autoTitleProvider.js';
import { createPlannerThoughtTypeProvider, type PlannerThoughtTypeProviderDeps } from './plannerProvider.js';
import { createToolParamsThoughtTypeProvider, type ToolParamsThoughtTypeProviderDeps } from './toolParamsProvider.js';
import type { ThoughtType, ThoughtTypeProvider } from '../types.js';

export type ThoughtProcessingProviderDeps = {
  autoTitle: AutoTitleThoughtTypeProviderDeps;
  planner: PlannerThoughtTypeProviderDeps;
  toolParams: ToolParamsThoughtTypeProviderDeps;
};

export type AnyThoughtTypeProvider = ThoughtTypeProvider<any, any, any, any>;

export function createThoughtTypeProviders(deps: ThoughtProcessingProviderDeps): Record<ThoughtType, AnyThoughtTypeProvider> {
  return {
    autoTitle: createAutoTitleThoughtTypeProvider(deps.autoTitle),
    planner: createPlannerThoughtTypeProvider(deps.planner),
    toolParams: createToolParamsThoughtTypeProvider(deps.toolParams),
  };
}

let thoughtTypeProviders: Record<ThoughtType, AnyThoughtTypeProvider> = {
  autoTitle: {
    runPrepare: async () => {
      throw new Error('autoTitle thought provider is not configured');
    },
    runReason: async () => {
      throw new Error('autoTitle thought provider is not configured');
    },
    runDecision: async () => {
      throw new Error('autoTitle thought provider is not configured');
    },
  },
  planner: {
    runPrepare: async () => {
      throw new Error('planner thought provider is not configured');
    },
    runReason: async () => {
      throw new Error('planner thought provider is not configured');
    },
    runDecision: async () => {
      throw new Error('planner thought provider is not configured');
    },
  },
  toolParams: {
    runPrepare: async () => {
      throw new Error('toolParams thought provider is not configured');
    },
    runReason: async () => {
      throw new Error('toolParams thought provider is not configured');
    },
    runDecision: async () => {
      throw new Error('toolParams thought provider is not configured');
    },
  },
};

export function configureThoughtTypeProviders(deps: ThoughtProcessingProviderDeps): void {
  thoughtTypeProviders = createThoughtTypeProviders(deps);
}

export function resolveThoughtTypeProvider(thoughtType: ThoughtType): AnyThoughtTypeProvider {
  return thoughtTypeProviders[thoughtType];
}
