import { Injectable } from '@nestjs/common';

/**
 * The slice of ConversationProcessorService the run_subagent tool needs to
 * drive a child conversation through the normal message pipeline.
 */
export type SubagentProcessor = {
  processMessage(conversationId: string, body: { message: string; agentId: string }): Promise<void>;
  isProcessing(conversationId: string): boolean;
  cancelProcessing(conversationId: string): number;
};

/**
 * Late-binding seam between ToolsModule and ConversationsModule: the tool
 * registry (and RunSubagentTool with it) is constructed before the
 * conversation processor exists, and importing ConversationsModule from
 * ToolsModule would be a module cycle. Instead ConversationProcessorService —
 * whose module already imports ToolsModule — registers itself here at
 * construction, and the tool resolves it per call.
 */
@Injectable()
export class SubagentBridge {
  private processor: SubagentProcessor | null = null;

  register(processor: SubagentProcessor): void {
    this.processor = processor;
  }

  get(): SubagentProcessor {
    if (!this.processor) {
      throw new Error('run_subagent: conversation processor is not available yet (backend still booting)');
    }
    return this.processor;
  }
}
