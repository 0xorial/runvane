import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  DEFAULT_TOOL_SANDBOX_ID,
  LOCAL_SANDBOX_ID,
  type SshSandboxConfig,
  type ToolSandbox,
  type ToolSandboxKind,
} from '../contracts/tool-sandbox.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { HostToolProxy, type ConversationToolRouter, type RouterInvokeOptions } from './host-tool-proxy.js';
import { HOST_TOOL_RULES_PROFILES } from './host-tool-rules.js';
import type { InvocationResult } from './protocol.js';
import { ToolSandboxesService } from './tool-sandboxes.service.js';
import { ToolHostClient, type ToolHostSpawnConfig } from './tool-host-client.js';
import { deployToolHostOverSsh } from './ssh-deploy.js';

/** The tool-host lives in-repo as a sibling of backend/ and frontend/. */
const HOST_ENTRY_RELATIVE = 'toolhost/src/host/main.ts';

/**
 * Connects the harness to tool-hosts and registers their target tools as proxies
 * in the shared ToolRegistry. The catalog is enumerated once from the local
 * host; each conversation's bound sandbox decides *where* a registered tool
 * actually runs — locally, over ssh, or not at all (`none`). One client per
 * sandbox is started lazily and reused. Best-effort: the app boots even if
 * no host is reachable, just without target tools.
 */
@Injectable()
export class ToolHostService implements OnModuleInit, OnModuleDestroy, ConversationToolRouter {
  private readonly logger = new Logger(ToolHostService.name);
  private readonly clients = new Map<string, ToolHostClient>();

  constructor(
    private readonly tools: ToolRegistry,
    private readonly conversations: ConversationsRepo,
    private readonly sandboxes: ToolSandboxesService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = resolveLocalSpawnConfig();
    if (!config) {
      this.logger.log('tool-host disabled (no host entry found); target tools not registered');
      return;
    }

    const client = new ToolHostClient(config);
    try {
      client.start();
      await client.ready();
      const descriptors = await client.listTools();
      this.clients.set(LOCAL_SANDBOX_ID, client);
      let registered = 0;
      for (const descriptor of descriptors) {
        // A host tool must not silently collide with a builtin over a name.
        // Capabilities belong in the tool-host, not duplicated as builtins
        // (that's how the filesystem split happened) — a collision here means
        // a builtin should probably be deleted, not that the proxy should win.
        if (this.tools.get(descriptor.name)) {
          this.logger.warn(`host tool ${descriptor.name} shadows builtin; keeping builtin`);
          continue;
        }
        try {
          this.tools.register(new HostToolProxy(this, descriptor, HOST_TOOL_RULES_PROFILES[descriptor.name]));
          registered += 1;
        } catch (err) {
          this.logger.warn(`skipping host tool ${descriptor.name}: ${(err as Error).message}`);
        }
      }
      this.logger.log(`tool-host connected via ${config.command}; registered ${registered} target tool(s)`);
    } catch (err) {
      this.logger.warn(`tool-host unavailable: ${(err as Error).message}; continuing without target tools`);
      await client.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
  }

  // ─── ConversationToolRouter ──────────────────────────────────────────────

  async sandboxKindForConversation(conversationId: string): Promise<ToolSandboxKind> {
    return (await this.resolveSandbox(conversationId)).kind;
  }

  async invokeForConversation(
    conversationId: string,
    toolName: string,
    params: unknown,
    opts: RouterInvokeOptions,
  ): Promise<InvocationResult> {
    const env = await this.resolveSandbox(conversationId);
    if (env.kind === 'none') {
      return errorResult('target tools are disabled for this conversation (sandbox: none)');
    }
    const client = await this.clientForSandbox(env);
    if (!client) return errorResult(`tool sandbox "${env.name}" is unavailable`);
    return client.invoke(toolName, params, opts);
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private async resolveSandbox(conversationId: string): Promise<ToolSandbox> {
    const envId = conversationId ? await this.conversations.getToolSandboxId(conversationId) : null;
    return this.sandboxes.getOrDefault(envId ?? DEFAULT_TOOL_SANDBOX_ID);
  }

  /** The connected client for an sandbox, started + cached on first use. */
  private async clientForSandbox(env: ToolSandbox): Promise<ToolHostClient | null> {
    const existing = this.clients.get(env.id);
    if (existing) return existing;

    if (env.kind === 'ssh' && env.ssh && !env.ssh.remoteCommand?.trim()) {
      this.logger.log(`deploying tool-host to "${env.name}" (${env.ssh.host}) over ssh`);
    }

    let config: ToolHostSpawnConfig | null;
    try {
      config = await resolveSpawnConfig(env);
    } catch (err) {
      this.logger.warn(`tool sandbox "${env.name}" deploy failed: ${(err as Error).message}`);
      return null;
    }
    if (!config) return null;

    const client = new ToolHostClient(config);
    try {
      client.start();
      await client.ready();
      this.clients.set(env.id, client);
      this.logger.log(`tool sandbox "${env.name}" connected via ${config.command}`);
      return client;
    } catch (err) {
      this.logger.warn(`tool sandbox "${env.name}" failed to connect: ${(err as Error).message}`);
      await client.close();
      return null;
    }
  }
}

function errorResult(message: string): InvocationResult {
  const now = new Date().toISOString();
  return { ok: false, output: null, error: message, timing: { startedAt: now, finishedAt: now, elapsedMs: 0 } };
}

async function resolveSpawnConfig(env: ToolSandbox): Promise<ToolHostSpawnConfig | null> {
  if (env.kind === 'none') return null;
  if (env.kind === 'ssh' && env.ssh) return sshSpawnConfig(env.ssh);
  return resolveLocalSpawnConfig();
}

/**
 * Build the ssh spawn config. With no explicit `remoteCommand`, the in-repo
 * tool-host source is shipped to the remote first (see ssh-deploy) and run via
 * node — so a bare container works with no preinstall. A `remoteCommand` opts
 * out: the remote is assumed to already expose a host on its PATH.
 */
async function sshSpawnConfig(ssh: SshSandboxConfig): Promise<ToolHostSpawnConfig> {
  const destination = ssh.user ? `${ssh.user}@${ssh.host}` : ssh.host;
  // accept-new trusts the host key on first contact (these are target sandboxes we're
  // standing up) but still refuses if a known key later changes. Without it,
  // BatchMode rejects the unknown key and a fresh container never connects.
  const baseArgs = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
  if (ssh.port) baseArgs.push('-p', String(ssh.port));
  if (ssh.identityFile) baseArgs.push('-i', ssh.identityFile);
  // Custom transport (docker sandboxes ride `docker exec … sshd -i`): still
  // real ssh, just not over TCP — the deploy path below works unchanged.
  if (ssh.proxyCommand) baseArgs.push('-o', `ProxyCommand=${ssh.proxyCommand}`);
  baseArgs.push(destination);
  const remote = ssh.remoteCommand?.trim() || (await deployToolHostOverSsh(baseArgs));
  return { command: 'ssh', args: [...baseArgs, remote] };
}

/**
 * The local built-in sandbox: run the in-repo host as a child, or — when
 * RUNVANE_TOOLHOST_SSH is set — point "local" at an external host. Returns null
 * when no host entry is present (so the app boots without target tools).
 */
function resolveLocalSpawnConfig(): ToolHostSpawnConfig | null {
  const ssh = process.env.RUNVANE_TOOLHOST_SSH?.trim();
  if (ssh) {
    const remote = process.env.RUNVANE_TOOLHOST_REMOTE_CMD?.trim() || 'runvane-toolhost';
    return { command: 'ssh', args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', ssh, remote] };
  }

  const entry = resolveHostEntry();
  if (!entry) return null;
  const command = process.env.RUNVANE_TOOLHOST_NODE?.trim() || process.execPath;
  return { command, args: [entry] };
}

/**
 * Locate the in-repo tool-host entry across the working directories we run
 * under (repo root, backend/, tests/), with a dev-container fallback. Override
 * with RUNVANE_TOOLHOST_HOST_ENTRY.
 */
function resolveHostEntry(): string | null {
  const explicit = process.env.RUNVANE_TOOLHOST_HOST_ENTRY?.trim();
  const candidates = [
    explicit,
    path.resolve(process.cwd(), HOST_ENTRY_RELATIVE),
    path.resolve(process.cwd(), '..', HOST_ENTRY_RELATIVE),
    `/workspace/${HOST_ENTRY_RELATIVE}`,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
