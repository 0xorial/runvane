import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { ListToolSandboxesResponse, ToolSandbox } from '../contracts/tool-sandbox.js';
import { UpsertToolSandboxDto } from './dto/upsert-tool-sandbox.dto.js';
import { ToolSandboxesService } from './tool-sandboxes.service.js';

@Controller('api/tool-sandboxes')
export class ToolSandboxesController {
  constructor(private readonly sandboxes: ToolSandboxesService) {}

  @Get()
  async list(): Promise<ListToolSandboxesResponse> {
    return { sandboxes: await this.sandboxes.list() };
  }

  @Post()
  async create(@Body() body: UpsertToolSandboxDto): Promise<ToolSandbox> {
    return this.sandboxes.upsert({ name: body.name, ssh: body.ssh });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpsertToolSandboxDto): Promise<ToolSandbox> {
    return this.sandboxes.upsert({ id, name: body.name, ssh: body.ssh });
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.sandboxes.remove(id);
    return { ok: true };
  }
}
