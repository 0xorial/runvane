import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { ListToolEnvironmentsResponse, ToolEnvironment } from '../contracts/tool-environment.js';
import { UpsertToolEnvironmentDto } from './dto/upsert-tool-environment.dto.js';
import { ToolEnvironmentsService } from './tool-environments.service.js';

@Controller('api/tool-environments')
export class ToolEnvironmentsController {
  constructor(private readonly environments: ToolEnvironmentsService) {}

  @Get()
  async list(): Promise<ListToolEnvironmentsResponse> {
    return { environments: await this.environments.list() };
  }

  @Post()
  async create(@Body() body: UpsertToolEnvironmentDto): Promise<ToolEnvironment> {
    return this.environments.upsert({ name: body.name, ssh: body.ssh });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpsertToolEnvironmentDto): Promise<ToolEnvironment> {
    return this.environments.upsert({ id, name: body.name, ssh: body.ssh });
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    await this.environments.remove(id);
    return { ok: true };
  }
}
