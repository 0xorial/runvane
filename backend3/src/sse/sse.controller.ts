import { Controller, MessageEvent, Param, Query, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SseHubService } from './sse-hub.service.js';

function parseAfterSeq(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < 0) return undefined;
  return Math.trunc(parsed);
}

@Controller('sse')
export class SseController {
  constructor(private readonly hub: SseHubService) {}

  @Sse('stream')
  stream(@Query('after_seq') afterSeqRaw?: string): Observable<MessageEvent> {
    return this.hub.stream({ afterSeq: parseAfterSeq(afterSeqRaw) });
  }

  @Sse('conversations/:conversationId/stream')
  conversationStream(
    @Param('conversationId') conversationId: string,
    @Query('after_seq') afterSeqRaw?: string,
  ): Observable<MessageEvent> {
    return this.hub.stream({
      conversationId,
      afterSeq: parseAfterSeq(afterSeqRaw),
    });
  }
}
