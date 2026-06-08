import { Body, Controller, Post } from '@nestjs/common';
import { AgentsService } from '../agents/agents.service.js';
import { ChatHistoryImportService } from './chat-history-import.service.js';

@Controller('api/import')
export class ImportController {
  constructor(
    private readonly imports: ChatHistoryImportService,
    private readonly agents: AgentsService,
  ) {}

  @Post('openai')
  async importOpenAi(@Body() body: unknown) {
    const agentId = await this.defaultAgentId();
    return this.imports.importOpenAi(body, agentId);
  }

  @Post('gemini')
  async importGemini(@Body() body: unknown) {
    const agentId = await this.defaultAgentId();
    return this.imports.importGemini(body, agentId);
  }

  @Post('claude')
  async importClaude(@Body() body: unknown) {
    const agentId = await this.defaultAgentId();
    return this.imports.importClaude(body, agentId);
  }

  @Post('grok')
  async importGrok(@Body() body: unknown) {
    const agentId = await this.defaultAgentId();
    return this.imports.importGrok(body, agentId);
  }

  @Post('auto')
  async importAuto(@Body() body: unknown) {
    const agentId = await this.defaultAgentId();
    return this.imports.importAuto(body, agentId);
  }

  private async defaultAgentId(): Promise<string> {
    const rows = await this.agents.list();
    const agent = rows.find((row) => row.is_default) ?? rows[0];
    if (!agent?.id) throw new Error('import: no default agent configured');
    return agent.id;
  }
}
