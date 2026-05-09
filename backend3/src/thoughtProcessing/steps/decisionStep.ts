import { Injectable } from '@nestjs/common';
import type { DecisionStepInput, ThoughtTypeProvider } from '../types.js';

@Injectable()
export class DecisionStep {
  async run(
    provider: ThoughtTypeProvider<any, any, any, any>,
    input: DecisionStepInput,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await provider.runDecision('decision', input);
  }
}
