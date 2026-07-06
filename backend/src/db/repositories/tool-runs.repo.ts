import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service.js';

export type ToolRunStatus = 'running' | 'done' | 'error' | 'aborted';

export type ToolRunRow = {
  id: string;
  conversationId: string;
  chatEntryId: string;
  agentId: string | null;
  toolId: string;
  attempt: number;
  retryOfRunId: string | null;
  status: string;
  parameters: Record<string, unknown>;
  result: unknown;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  elapsedMs: number | null;
};

/**
 * Per-attempt audit of tool executions. The tool-invocation chat entry is the
 * transcript surface and is mutated in place on approve/retry; each actual
 * execution gets exactly one immutable row here (running → done/error/aborted).
 */
@Injectable()
export class ToolRunsRepo {
  constructor(private readonly prisma: PrismaService) {}

  /** Insert the row for an execution that just started; returns its id. */
  async beginRun(args: {
    conversationId: string;
    chatEntryId: string;
    agentId?: string;
    toolId: string;
    parameters: Record<string, unknown>;
    startedAt: Date;
  }): Promise<string> {
    // Attempt numbering + retry link derive from the previous run of the same
    // entry, so callers don't have to thread history around.
    const prev = await this.latestForEntry(args.conversationId, args.chatEntryId);
    const id = randomUUID();
    await this.prisma.toolRun.create({
      data: {
        id,
        conversationId: args.conversationId,
        chatEntryId: args.chatEntryId,
        agentId: args.agentId ?? null,
        toolId: args.toolId,
        attempt: (prev?.attempt ?? 0) + 1,
        retryOfRunId: prev?.id ?? null,
        status: 'running',
        parametersJson: JSON.parse(JSON.stringify(args.parameters)),
        startedAt: args.startedAt,
      },
    });
    return id;
  }

  async finishRun(args: {
    id: string;
    status: Exclude<ToolRunStatus, 'running'>;
    result?: unknown;
    error?: string;
    finishedAt: Date;
    elapsedMs: number;
  }): Promise<void> {
    await this.prisma.toolRun.update({
      where: { id: args.id },
      data: {
        status: args.status,
        resultJson: args.result === undefined ? undefined : JSON.parse(JSON.stringify(args.result)),
        error: args.error ?? null,
        finishedAt: args.finishedAt,
        elapsedMs: args.elapsedMs,
      },
    });
  }

  async latestForEntry(conversationId: string, chatEntryId: string): Promise<ToolRunRow | null> {
    const row = await this.prisma.toolRun.findFirst({
      where: { conversationId, chatEntryId },
      orderBy: { attempt: 'desc' },
    });
    return row ? toRow(row) : null;
  }

  async listForEntry(conversationId: string, chatEntryId: string): Promise<ToolRunRow[]> {
    const rows = await this.prisma.toolRun.findMany({
      where: { conversationId, chatEntryId },
      orderBy: { attempt: 'asc' },
    });
    return rows.map(toRow);
  }
}

function toRow(row: {
  id: string;
  conversationId: string;
  chatEntryId: string;
  agentId: string | null;
  toolId: string;
  attempt: number;
  retryOfRunId: string | null;
  status: string;
  parametersJson: unknown;
  resultJson: unknown;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  elapsedMs: number | null;
}): ToolRunRow {
  const params = typeof row.parametersJson === 'string' ? JSON.parse(row.parametersJson) : row.parametersJson;
  const result = typeof row.resultJson === 'string' ? JSON.parse(row.resultJson) : row.resultJson;
  return {
    id: row.id,
    conversationId: row.conversationId,
    chatEntryId: row.chatEntryId,
    agentId: row.agentId,
    toolId: row.toolId,
    attempt: row.attempt,
    retryOfRunId: row.retryOfRunId,
    status: row.status,
    parameters: params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {},
    result: result ?? null,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    elapsedMs: row.elapsedMs,
  };
}
