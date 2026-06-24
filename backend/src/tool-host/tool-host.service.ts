import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { ToolRegistry } from '../tools/tool-registry.js';
import { HostToolProxy } from './host-tool-proxy.js';
import { ToolHostClient, type ToolHostSpawnConfig } from './tool-host-client.js';

const DEFAULT_HOST_ENTRY = '/shared/runvane-toolhost/src/host/main.ts';

/**
 * Connects the brain to a tool-host and registers its runtime tools as proxies
 * in the shared ToolRegistry. The host is the extracted @runvane/toolhost; the
 * server runs it directly as a local child, or refers to one running externally
 * over ssh (RUNVANE_TOOLHOST_SSH). Best-effort: if the host can't be reached the
 * app still boots, just without runtime tools.
 */
@Injectable()
export class ToolHostService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ToolHostService.name);
  private client: ToolHostClient | null = null;

  constructor(private readonly tools: ToolRegistry) {}

  async onModuleInit(): Promise<void> {
    const config = resolveSpawnConfig();
    if (!config) {
      this.logger.log('tool-host disabled (no host entry found); runtime tools not registered');
      return;
    }

    const client = new ToolHostClient(config);
    try {
      client.start();
      await client.ready();
      const descriptors = await client.listTools();
      let registered = 0;
      for (const descriptor of descriptors) {
        try {
          this.tools.register(new HostToolProxy(client, descriptor));
          registered += 1;
        } catch (err) {
          // A name collision with a built-in tool just means we keep the local
          // one; log and move on rather than failing startup.
          this.logger.warn(`skipping host tool ${descriptor.name}: ${(err as Error).message}`);
        }
      }
      this.client = client;
      this.logger.log(`tool-host connected via ${config.command}; registered ${registered} runtime tool(s)`);
    } catch (err) {
      this.logger.warn(`tool-host unavailable: ${(err as Error).message}; continuing without runtime tools`);
      await client.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
}

/**
 * The single switch the server flips: refer to an external host over ssh, or
 * run one directly as a local child. Returns null when no local host entry is
 * present (so the app boots without runtime tools).
 */
function resolveSpawnConfig(): ToolHostSpawnConfig | null {
  const ssh = process.env.RUNVANE_TOOLHOST_SSH?.trim();
  if (ssh) {
    const remote = process.env.RUNVANE_TOOLHOST_REMOTE_CMD?.trim() || 'runvane-toolhost';
    return { command: 'ssh', args: ['-T', '-o', 'BatchMode=yes', ssh, remote] };
  }

  const entry = process.env.RUNVANE_TOOLHOST_HOST_ENTRY?.trim() || DEFAULT_HOST_ENTRY;
  if (!existsSync(entry)) return null;
  const command = process.env.RUNVANE_TOOLHOST_NODE?.trim() || process.execPath;
  return { command, args: [entry] };
}
