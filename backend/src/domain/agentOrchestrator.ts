import type { AgentJob } from "./agentJob.js";
import { ConversationEventHub } from "../events/conversationEventHub.js";
import { InMemoryConversationStore } from "../infra/inMemoryConversationStore.js";
import { SseType } from "../types/sse.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeAssistantReply(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("time")) {
    return `Current server time is ${new Date().toISOString()}.`;
  }
  return `Echo: ${message}`;
}

export class AgentOrchestrator {
  constructor(
    private readonly store: InMemoryConversationStore,
    private readonly hub: ConversationEventHub,
  ) {}

  async run(job: AgentJob): Promise<void> {
    const conversationId = job.conversation_id;
    const plannerEntryId = `planner-${conversationId}-${job.enqueued_at_ms}`;
    const conversationIndex = this.store.listMessages(conversationId).length;
    const createdAt = new Date().toISOString();

    this.hub.publish(conversationId, {
      type: SseType.PLANNER_STARTING,
      chat_entry_id: plannerEntryId,
      conversationIndex,
      createdAt,
      request_text: job.message,
    });

    const reply = fakeAssistantReply(job.message);
    const chunks = [reply.slice(0, 16), reply.slice(16, 40), reply.slice(40)].filter((x) => x.length > 0);

    for (const delta of chunks) {
      await sleep(120);
      this.hub.publish(conversationId, {
        type: SseType.PLANNER_LLM_STREAM,
        chat_entry_id: plannerEntryId,
        delta,
      });
    }

    this.store.appendAssistantMessage(conversationId, reply);

    this.hub.publish(conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chat_entry_id: plannerEntryId,
      summary: reply,
      finished: true,
      action: "final_answer",
    });
  }
}
