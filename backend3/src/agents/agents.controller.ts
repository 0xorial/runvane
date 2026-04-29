import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { AgentsService } from './agents.service.js';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto.js';

@Controller('api/agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  async list() {
    return this.agents.list();
  }

  @Post()
  async create(@Body() body: CreateAgentDto) {
    return this.agents.create(body);
  }

  @Get(':agentId')
  async get(@Param('agentId') agentId: string) {
    const row = await this.agents.get(agentId);
    if (!row) throw new NotFoundException('agent not found');
    return row;
  }

  @Put(':agentId')
  async update(@Param('agentId') agentId: string, @Body() body: UpdateAgentDto) {
    const updated = await this.agents.update(agentId, body);
    if (!updated) throw new NotFoundException('agent not found');
    return updated;
  }

  @Delete(':agentId')
  async delete(@Param('agentId') agentId: string) {
    const ok = await this.agents.delete(agentId);
    if (!ok) throw new NotFoundException('agent not found');
    return { ok: true };
  }
}
