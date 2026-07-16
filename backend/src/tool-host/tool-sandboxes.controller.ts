import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { ListToolSandboxesResponse, ToolSandbox } from '../contracts/tool-sandbox.js';
import { CreateDockerSandboxDto } from './dto/create-docker-sandbox.dto.js';
import { UpsertToolSandboxDto } from './dto/upsert-tool-sandbox.dto.js';
import { SandboxContainersService } from './sandbox-containers.service.js';
import { ToolSandboxesService } from './tool-sandboxes.service.js';

@Controller('api/tool-sandboxes')
export class ToolSandboxesController {
  constructor(
    private readonly sandboxes: ToolSandboxesService,
    private readonly containers: SandboxContainersService,
  ) {}

  @Get()
  async list(): Promise<ListToolSandboxesResponse> {
    return { sandboxes: await this.sandboxes.list() };
  }

  @Post()
  async create(@Body() body: UpsertToolSandboxDto): Promise<ToolSandbox> {
    return this.sandboxes.upsert({ name: body.name, ssh: body.ssh });
  }

  /** Create a runvane-managed docker sandbox and register it (as ssh). */
  @Post('docker')
  async createDocker(@Body() body: CreateDockerSandboxDto): Promise<ToolSandbox> {
    const sandboxId = `sbx-${crypto.randomUUID().slice(0, 8)}`;
    const row = await this.containers.create(sandboxId, body);
    try {
      return await this.sandboxes.saveRow(row);
    } catch (err) {
      // Registration failed after the container was made — don't leak it.
      await this.containers.teardown(row.docker!.containerName, sandboxId);
      throw err;
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: UpsertToolSandboxDto): Promise<ToolSandbox> {
    return this.sandboxes.upsert({ id, name: body.name, ssh: body.ssh });
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: true }> {
    // Docker-backed sandboxes own a container + key material — tear those
    // down before dropping the row (derived from the row, never from memory).
    const row = await this.sandboxes.get(id);
    if (row?.docker) await this.containers.teardown(row.docker.containerName, id);
    await this.sandboxes.remove(id);
    return { ok: true };
  }
}
