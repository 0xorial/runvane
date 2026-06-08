import { Controller, Get, Headers, MessageEvent, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SseHubService } from '../sse/sse-hub.service.js';
import { listToolCatalog } from '../tools/tool-catalog.api.js';
import { ToolRegistry } from '../tools/tool-registry.js';

function parseAfterSeq(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.trunc(parsed);
}

@Controller('api')
export class SystemController {
  constructor(
    private readonly hub: SseHubService,
    private readonly tools: ToolRegistry,
  ) {}

  @Get('types/ping')
  typesPing() {
    return { sseTypeSample: 'conversation.updated' } as const;
  }

  @Get('tools')
  listTools() {
    return listToolCatalog(this.tools);
  }

  @Sse('stream')
  stream(
    @Query('after_seq') afterSeqRaw?: string,
    @Headers('last-event-id') lastEventIdRaw?: string,
  ): Observable<MessageEvent> {
    const afterSeq = parseAfterSeq(afterSeqRaw) ?? parseAfterSeq(lastEventIdRaw);
    return this.hub.stream({ afterSeq });
  }
}
