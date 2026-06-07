import { Injectable } from '@nestjs/common';
import type {
  AssistantMessageEntry,
  ChatAttachment,
  ToolInvocationEntry,
  UserMessageEntry,
} from '../../contracts/chatEntry.js';
import type { UserMessageOverrides } from '../../contracts/user-message-overrides.js';
import type { LlmRef } from '../../contracts/llm.js';
import type { ThoughtStreamEntryType } from '../../thoughtProcessing/types.js';
import { PrismaService } from '../prisma.service.js';
import type { ThoughtStepStatus } from './chat-entries.types.js';
import { ChatEntriesBaseRepo } from './chat-entries-base.repo.js';

export type ToolInvocationState = ToolInvocationEntry['state'];

export type { ChatEntryDbRow, ChatMessageEntry, ThoughtStepStatus } from './chat-entries.types.js';

@Injectable()
export class ChatEntriesRepo extends ChatEntriesBaseRepo {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async appendUserMessage(
    conversationId: string,
    input: {
      text: string;
      agentId: string;
      llm?: LlmRef;
      modelPresetId?: number;
      parentId: string | null;
      attachments?: ChatAttachment[];
      overrides?: UserMessageOverrides;
    },
  ): Promise<UserMessageEntry> {
    const payload: Record<string, unknown> = { text: input.text, agentId: input.agentId };
    if (input.llm) payload.llm = input.llm;
    if (input.modelPresetId !== undefined) payload.modelPresetId = input.modelPresetId;
    if (input.attachments && input.attachments.length > 0) payload.attachments = input.attachments;
    if (input.overrides) payload.overrides = input.overrides;
    const row = await this.appendEntry(conversationId, {
      type: 'user-message',
      parentId: input.parentId,
      payload,
    });
    const result: UserMessageEntry = {
      type: 'user-message',
      id: row.id,
      conversationIndex: row.conversationIndex,
      createdAt: row.createdAt,
      parentId: row.parentId,
      text: input.text,
      agentId: input.agentId,
    };
    if (input.llm) result.llm = input.llm;
    if (input.modelPresetId !== undefined) result.modelPresetId = input.modelPresetId;
    if (input.attachments && input.attachments.length > 0) result.attachments = input.attachments;
    if (input.overrides) result.overrides = input.overrides;
    return result;
  }

  async appendAssistantMessage(
    conversationId: string,
    input: { text: string; parentId: string | null },
  ): Promise<AssistantMessageEntry> {
    const row = await this.appendEntry(conversationId, {
      type: 'assistant-message',
      parentId: input.parentId,
      payload: { text: input.text },
    });
    return {
      type: 'assistant-message',
      id: row.id,
      conversationIndex: row.conversationIndex,
      createdAt: row.createdAt,
      parentId: row.parentId,
      text: input.text,
    };
  }

  async appendThoughtPrepareEntry(
    conversationId: string,
    input: {
      thoughtId: string;
      parentId: string | null;
      status?: ThoughtStepStatus;
      requestText?: string;
      title?: string;
      llm?: LlmRef;
    },
  ): Promise<{ id: string }> {
    const payload: Record<string, unknown> = {
      thoughtId: input.thoughtId,
      requestText: input.requestText ?? '',
      status: input.status ?? 'running',
    };
    if (input.title) payload.title = input.title;
    if (input.llm) payload.llm = input.llm;
    const row = await this.appendEntry(conversationId, {
      type: 'thought-prepare',
      parentId: input.parentId,
      payload,
    });
    return { id: row.id };
  }

  async appendThoughtStreamEntry(
    conversationId: string,
    input: {
      type: ThoughtStreamEntryType;
      thoughtId: string;
      parentId: string | null;
      status?: ThoughtStepStatus;
      llm?: LlmRef;
    },
  ): Promise<{ id: string }> {
    const payload: Record<string, unknown> = {
      thoughtId: input.thoughtId,
      llmRequest: '',
      llmResponse: '',
      thoughtMs: null,
      decision: null,
      status: input.status ?? 'running',
    };
    if (input.llm) payload.llm = input.llm;
    const row = await this.appendEntry(conversationId, {
      type: input.type,
      parentId: input.parentId,
      payload,
    });
    return { id: row.id };
  }

  async appendCheckpointSummary(
    conversationId: string,
    input: {
      parentId: string | null;
      summarizedRange: { fromEntryId: string; toEntryId: string };
      summaryText: string;
      rangeEntryCount?: number;
      rangeInputTokens?: number;
      summaryTokens?: number;
    },
  ): Promise<{ id: string; parentId: string | null; conversationIndex: number; createdAt: string }> {
    const payload: Record<string, unknown> = {
      summarizedRange: input.summarizedRange,
      summaryText: input.summaryText,
    };
    if (input.rangeEntryCount !== undefined) payload.rangeEntryCount = input.rangeEntryCount;
    if (input.rangeInputTokens !== undefined) payload.rangeInputTokens = input.rangeInputTokens;
    if (input.summaryTokens !== undefined) payload.summaryTokens = input.summaryTokens;
    const row = await this.appendEntry(conversationId, {
      type: 'checkpoint-summary',
      parentId: input.parentId,
      payload,
    });
    return row;
  }

  async appendThoughtActionEntry(
    conversationId: string,
    input: {
      thoughtId: string;
      parentId: string | null;
      status?: ThoughtStepStatus;
      summary?: string;
    },
  ): Promise<{ id: string }> {
    const payload: Record<string, unknown> = {
      thoughtId: input.thoughtId,
      status: input.status ?? 'running',
    };
    if (input.summary) payload.summary = input.summary;
    const row = await this.appendEntry(conversationId, {
      type: 'thought-action',
      parentId: input.parentId,
      payload,
    });
    return { id: row.id };
  }

  async updateThoughtAction(
    conversationId: string,
    entryId: string,
    patch: {
      status?: ThoughtStepStatus;
      summary?: string;
      action?: string;
      toolName?: string;
      error?: string;
    },
  ): Promise<void> {
    const row = await this.fetchEntryRow(conversationId, entryId);
    if (!row || row.type !== 'thought-action') {
      throw new Error(`thought-action entry not found: ${entryId}`);
    }
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    if (patch.status) payload.status = patch.status;
    if (patch.summary !== undefined) payload.summary = patch.summary;
    if (patch.action !== undefined) payload.action = patch.action;
    if (patch.toolName !== undefined) payload.toolName = patch.toolName;
    if (patch.error !== undefined) payload.error = patch.error;
    await this.prisma.$executeRawUnsafe(
      `UPDATE chat_entries SET payload_json = ? WHERE conversation_id = ? AND id = ? AND type = 'thought-action'`,
      JSON.stringify(payload),
      conversationId,
      entryId,
    );
  }

  async appendToolInvocation(
    conversationId: string,
    input: {
      toolId: string;
      state: ToolInvocationState;
      parameters: Record<string, unknown>;
      result?: unknown;
      parentId: string | null;
    },
  ): Promise<{ id: string; parentId: string | null }> {
    const payload: Record<string, unknown> = {
      toolId: input.toolId,
      state: input.state,
      parameters: input.parameters,
      result: input.result ?? null,
    };
    const row = await this.appendEntry(conversationId, {
      type: 'tool-invocation',
      parentId: input.parentId,
      payload,
    });
    return { id: row.id, parentId: row.parentId };
  }

  async updateToolInvocation(
    conversationId: string,
    input: { id: string; state: ToolInvocationState; result?: unknown; parameters?: Record<string, unknown> },
  ): Promise<void> {
    const patch: Record<string, unknown> = { state: input.state };
    if (input.result !== undefined) patch.result = input.result;
    if (input.parameters !== undefined) patch.parameters = input.parameters;
    await this.mergeEntryPayload(conversationId, input.id, patch);
  }

  async updateAssistantMessage(
    conversationId: string,
    input: { id: string; text: string },
  ): Promise<void> {
    const existing = (await this.prisma.$queryRawUnsafe(
      `SELECT 1 AS present
       FROM chat_entries
       WHERE conversation_id = ? AND id = ? AND type = 'assistant-message'
       LIMIT 1`,
      conversationId,
      input.id,
    )) as Array<{ present: number }>;
    if (existing.length === 0) throw new Error(`assistant-message not found: ${input.id}`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE chat_entries
       SET payload_json = ?
       WHERE conversation_id = ? AND id = ? AND type = 'assistant-message'`,
      JSON.stringify({ text: input.text }),
      conversationId,
      input.id,
    );
  }
}
