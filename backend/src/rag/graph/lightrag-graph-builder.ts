import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import type { SourceGraphInput } from '../store/rag-store.types.js';
import type {
  GraphBuilder,
  GraphBuilderInput,
  GraphExtractionResult,
  GraphExtractionUsage,
} from './graph-builder.js';

const LightRagParamsSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    /** LightRAG's entity_extract_max_gleaning ("did you miss anything" loops). */
    maxGleaning: z.number().finite().int().min(0).max(3).default(1),
  })
  .strict();

/** Providers whose stored settings may omit base_url (their adapter defaults it). */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  grok: 'https://api.x.ai/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
};

const PING_TIMEOUT_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 300_000;
const INSTALL_HINT =
  "the LightRAG builder bootstraps its own Python env on first use; it only needs `python3` (>=3.10) on the backend's PATH";

export type SidecarGraphReply = {
  entities?: Array<{ name?: unknown; type?: unknown; description?: unknown }>;
  relations?: Array<{ source?: unknown; target?: unknown; relation?: unknown; description?: unknown }>;
  usage?: { llm_calls?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown; cost_usd?: unknown };
};

export function mapSidecarUsage(reply: SidecarGraphReply): GraphExtractionUsage | null {
  const usage = reply.usage;
  if (!usage || typeof usage !== 'object') return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    llmCalls: num(usage.llm_calls),
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    costUsd: typeof usage.cost_usd === 'number' && Number.isFinite(usage.cost_usd) ? usage.cost_usd : null,
  };
}

/**
 * Map a sidecar extraction reply into the normalized graph contract. Mentions
 * are deliberately omitted — LightRAG chunks text its own way, so chunk
 * provenance comes from ingestion's substring backfill instead.
 */
export function mapSidecarReply(reply: SidecarGraphReply): SourceGraphInput {
  const nodes: SourceGraphInput['nodes'] = [];
  for (const entity of reply.entities ?? []) {
    const name = typeof entity.name === 'string' ? entity.name.trim() : '';
    if (!name) continue;
    nodes.push({
      name,
      type: typeof entity.type === 'string' && entity.type.trim() ? entity.type.trim() : undefined,
      description:
        typeof entity.description === 'string' && entity.description.trim()
          ? entity.description.trim().slice(0, 500)
          : undefined,
    });
  }
  const edges: SourceGraphInput['edges'] = [];
  for (const rel of reply.relations ?? []) {
    const source = typeof rel.source === 'string' ? rel.source.trim() : '';
    const target = typeof rel.target === 'string' ? rel.target.trim() : '';
    if (!source || !target) continue;
    edges.push({
      source,
      target,
      relation:
        typeof rel.relation === 'string' && rel.relation.trim() ? rel.relation.trim().slice(0, 200) : 'related to',
      description:
        typeof rel.description === 'string' && rel.description.trim()
          ? rel.description.trim().slice(0, 500)
          : undefined,
    });
  }
  return { nodes, edges, mentions: [] };
}

type Pending = {
  resolve: (reply: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * Graph builder backed by the real LightRAG library, run as a long-lived
 * Python sidecar (backend/python/lightrag_sidecar.py) speaking NDJSON over
 * stdio — the same brain/limb split as the toolhost. Configuration is
 * deliberately zero beyond provider+model: on first use the builder creates
 * a private venv under ~/.cache/runvane and pip-installs lightrag-hku there
 * (per machine+arch, never on a shared workspace mount), then reuses it.
 */
@Injectable()
export class LightRagGraphBuilder implements GraphBuilder, OnModuleDestroy {
  readonly type = 'lightrag';
  readonly label = 'LightRAG (sidecar)';
  private readonly logger = new Logger(LightRagGraphBuilder.name);

  private child: ChildProcessWithoutNullStreams | null = null;
  private childReady: Promise<void> | null = null;
  private bootstrapped: Promise<string> | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private destroyed = false;

  constructor(private readonly providerSettings: LlmProviderSettingsRepo) {}

  onModuleDestroy(): void {
    this.destroyed = true;
    this.killChild(new Error('shutting down'));
  }

  validateParams(params: Record<string, unknown>): void {
    LightRagParamsSchema.parse(params);
    const probe = spawnSync(pythonBin(), ['--version'], { timeout: 5_000 });
    if (probe.error || probe.status !== 0) {
      throw new Error(`python3 not found on PATH — ${INSTALL_HINT}`);
    }
  }

  async extract(input: GraphBuilderInput, signal?: AbortSignal): Promise<GraphExtractionResult> {
    const params = LightRagParamsSchema.parse(input.params);
    const settings = (await this.providerSettings.getProviderSettings(params.providerId)) ?? {};
    const baseUrl = String(settings.base_url ?? DEFAULT_BASE_URLS[params.providerId] ?? '').trim();
    if (!baseUrl) {
      throw new Error(
        `lightrag builder: provider '${params.providerId}' has no base_url and no known default — it must be OpenAI-compatible`,
      );
    }

    await this.ensureChild();
    const reply = await this.request(
      {
        op: 'extract',
        text: input.chunks.map((c) => c.text).join('\n\n'),
        config: {
          model: params.model,
          base_url: baseUrl,
          ...(settings.api_key ? { api_key: String(settings.api_key) } : {}),
          max_gleaning: params.maxGleaning,
        },
      },
      EXTRACT_TIMEOUT_MS,
      signal,
    );
    const parsed = reply as SidecarGraphReply;
    return { graph: mapSidecarReply(parsed), usage: mapSidecarUsage(parsed) };
  }

  /** One-time venv bootstrap; returns the venv's python binary. */
  private bootstrap(): Promise<string> {
    if (this.bootstrapped) return this.bootstrapped;
    this.bootstrapped = (async () => {
      const venvDir =
        process.env.RUNVANE_LIGHTRAG_VENV ??
        path.join(os.homedir(), '.cache', 'runvane', `lightrag-venv-${process.platform}-${process.arch}`);
      const venvPython = path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      if (existsSync(venvPython) && (await this.canImportLightrag(venvPython))) return venvPython;

      this.logger.log(`bootstrapping LightRAG venv at ${venvDir} (one-time pip install)`);
      await run(pythonBin(), ['-m', 'venv', venvDir], 120_000);
      await run(venvPython, ['-m', 'pip', 'install', '--quiet', 'lightrag-hku'], 600_000);
      if (!(await this.canImportLightrag(venvPython))) {
        throw new Error(`LightRAG venv bootstrap failed at ${venvDir} — ${INSTALL_HINT}`);
      }
      this.logger.log('LightRAG venv ready');
      return venvPython;
    })();
    this.bootstrapped.catch(() => (this.bootstrapped = null)); // allow retry
    return this.bootstrapped;
  }

  private async canImportLightrag(python: string): Promise<boolean> {
    try {
      await run(python, ['-c', 'import lightrag, networkx'], 30_000);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureChild(): Promise<void> {
    if (this.destroyed) throw new Error('lightrag builder is shutting down');
    if (this.child && this.childReady) return this.childReady;
    const python = await this.bootstrap();
    const script = sidecarScriptPath();
    const child = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;

    createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line));
    createInterface({ input: child.stderr }).on('line', (line) => this.logger.debug(line));
    child.on('exit', (code) => {
      this.logger.warn(`lightrag sidecar exited (code=${code})`);
      if (this.child === child) this.killChild(new Error(`lightrag sidecar exited (code=${code})`));
    });

    this.childReady = this.request({ op: 'ping' }, PING_TIMEOUT_MS).then((reply) => {
      this.logger.log(`lightrag sidecar ready (lightrag ${String(reply.lightrag)}, python ${String(reply.python)})`);
    });
    this.childReady.catch(() => this.killChild(new Error('lightrag sidecar failed the startup ping')));
    return this.childReady;
  }

  private onLine(line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.logger.warn(`lightrag sidecar emitted non-JSON on stdout: ${line.slice(0, 200)}`);
      return;
    }
    const id = typeof parsed.id === 'number' ? parsed.id : null;
    if (id === null) return;
    const waiter = this.pending.get(id);
    if (!waiter) return;
    this.pending.delete(id);
    clearTimeout(waiter.timer);
    if (parsed.ok === true) waiter.resolve(parsed);
    else waiter.reject(new Error(`lightrag sidecar: ${String(parsed.error ?? 'unknown error')}`));
  }

  private request(
    payload: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('lightrag sidecar is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`lightrag sidecar request timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      timer.unref?.();
      const onAbort = (): void => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, {
        resolve: (reply) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(reply);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
        timer,
      });
      child.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
    });
  }

  private killChild(reason: Error): void {
    const child = this.child;
    this.child = null;
    this.childReady = null;
    for (const [id, waiter] of this.pending) {
      this.pending.delete(id);
      clearTimeout(waiter.timer);
      waiter.reject(reason);
    }
    if (child && child.exitCode === null) child.kill();
  }
}

function pythonBin(): string {
  return process.env.RUNVANE_PYTHON ?? 'python3';
}

function sidecarScriptPath(): string {
  const override = process.env.RUNVANE_LIGHTRAG_SIDECAR;
  if (override) return override;
  const candidates = [
    path.resolve(process.cwd(), 'python/lightrag_sidecar.py'),
    path.resolve(process.cwd(), 'backend/python/lightrag_sidecar.py'),
    path.resolve(process.cwd(), '../backend/python/lightrag_sidecar.py'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`lightrag sidecar script not found (looked at: ${candidates.join(', ')})`);
  return found;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`${bin} ${args.join(' ')} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    timer.unref?.();
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${bin} ${args.join(' ')} exited with ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}
