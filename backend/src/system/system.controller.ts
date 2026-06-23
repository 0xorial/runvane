import { Controller, Get, MessageEvent, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SseHubService } from '../sse/sse-hub.service.js';
import { listToolCatalog } from '../tools/tool-catalog.api.js';
import { ToolRegistry } from '../tools/tool-registry.js';

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
  stream(): Observable<MessageEvent> {
    // Pure live tail. Resumability is the client's job: on (re)connect it takes
    // a fresh snapshot (carrying a seq watermark) and applies events after it.
    return this.hub.stream();
  }
}
