import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import type { PreinjectPreviewResult } from '../contracts/preinject.js';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { estimateContextTokens } from '../knowledge/retrieval/retrieval-context.js';
import { formatContextFilesBlock } from './context-files-block.js';
import { ContextInjectionService } from './context-injection.service.js';

/**
 * Composer preview for the `files` half of context injection: runs the same
 * workspace scan a conversation's first message with this agent would run —
 * persisting nothing — and prices it with the same estimator as the knowledge
 * preview (`/api/knowledge/retrieve/preview`), so the composer can show what
 * WILL ride along with the send before it happens. `totalTokens` is computed
 * from the exact planner block (formatContextFilesBlock), per-file `tokens`
 * from that file's section of it.
 */
@Controller('api/context-injection')
export class ContextInjectionController {
  constructor(
    private readonly agents: AgentsRepo,
    private readonly contextInjection: ContextInjectionService,
  ) {}

  @Get('preview')
  async preview(@Query('agentId') agentId?: string): Promise<PreinjectPreviewResult> {
    if (!agentId?.trim()) throw new BadRequestException('agentId is required');
    const agent = await this.agents.get(agentId);
    if (!agent) throw new NotFoundException(`agent ${agentId} not found`);

    const config = agent.default_llm_configuration?.preinject ?? undefined;
    const mode = config?.mode ?? 'none';
    const result = await this.contextInjection.scan(config);
    if (!result) return { mode, files: [], totalTokens: 0 };

    const files = result.files.map((file) => {
      const section = result.sections[file.path];
      return section === undefined ? file : { ...file, content: section, tokens: estimateContextTokens(section) };
    });
    const block = formatContextFilesBlock(result.content);
    return { mode, files, totalTokens: block ? estimateContextTokens(block) : 0 };
  }
}
