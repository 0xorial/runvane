import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import type { CreateDockerSandboxRequest, ToolSandbox } from '../contracts/tool-sandbox.js';
import {
  buildRunArgs,
  DEFAULT_SANDBOX_IMAGE,
  SANDBOX_USER,
  sandboxContainerName,
  sshConfigForContainer,
  validateMounts,
} from './sandbox-container.args.js';

const execFileAsync = promisify(execFile);

/**
 * Lifecycle of runvane-managed docker sandboxes: build/pull the image, run the
 * container (with the requested harness-host mounts), install a per-sandbox
 * ssh key, and hand back a plain ssh ToolSandbox row — connectivity and
 * tool-host deployment are then the existing ssh machinery's job. State lives
 * in docker + the sandbox row, never in memory: teardown derives everything
 * from the row's `docker` metadata.
 */
@Injectable()
export class SandboxContainersService {
  private readonly logger = new Logger(SandboxContainersService.name);

  async create(sandboxId: string, req: CreateDockerSandboxRequest): Promise<ToolSandbox> {
    const mounts = req.mounts ?? [];
    const mountError = validateMounts(mounts);
    if (mountError) throw new BadRequestException(mountError);

    const image = req.image?.trim() || DEFAULT_SANDBOX_IMAGE;
    await this.ensureImage(image);

    const containerName = sandboxContainerName(sandboxId);
    const identityFile = await this.generateKeypair(sandboxId);
    try {
      await this.runContainer(containerName, image, mounts);
      await this.installAuthorizedKey(containerName, `${identityFile}.pub`);
    } catch (err) {
      // Leave nothing half-made: a failed step removes the container + keys.
      await this.teardown(containerName, sandboxId).catch(() => {});
      throw err;
    }

    return {
      id: sandboxId,
      name: req.name.trim(),
      kind: 'ssh',
      builtin: false,
      ssh: sshConfigForContainer(containerName, identityFile),
      docker: { containerName, image, mounts },
    };
  }

  /** Remove the container (force) and the per-sandbox key material. */
  async teardown(containerName: string, sandboxId: string): Promise<void> {
    await this.docker(['rm', '-f', containerName]).catch((err) => {
      this.logger.warn(`sandbox container ${containerName} removal failed: ${(err as Error).message}`);
    });
    await rm(this.keysDir(sandboxId), { recursive: true, force: true });
  }

  /** Run with resource caps; if the daemon can't apply cgroup config (docker
   *  cgroup parent in threaded cgroupv2 mode — seen on nested/hive daemons),
   *  retry uncapped rather than failing sandbox creation. */
  private async runContainer(
    containerName: string,
    image: string,
    mounts: CreateDockerSandboxRequest['mounts'],
  ): Promise<void> {
    try {
      await this.docker(buildRunArgs({ containerName, image, mounts }));
    } catch (err) {
      if (!/cgroup/i.test((err as Error).message)) throw err;
      this.logger.warn(`daemon rejected resource caps for ${containerName}; retrying without limits`);
      await this.docker(['rm', '-f', containerName]).catch(() => {});
      await this.docker(buildRunArgs({ containerName, image, mounts, withResourceCaps: false }));
    }
  }

  /** Image ready = present locally, else build the in-repo default, else pull. */
  private async ensureImage(image: string): Promise<void> {
    const present = await this.docker(['image', 'inspect', image]).then(
      () => true,
      () => false,
    );
    if (present) return;

    if (image === DEFAULT_SANDBOX_IMAGE) {
      const contextDir = resolveSandboxImageDir();
      if (!contextDir) {
        throw new BadRequestException(
          `sandbox image ${image} is not available and the in-repo sandbox/ build context was not found`,
        );
      }
      this.logger.log(`building sandbox image ${image} from ${contextDir} (first use)`);
      await this.docker(['build', '-t', image, contextDir], 600_000);
      return;
    }
    this.logger.log(`pulling sandbox image ${image}`);
    await this.docker(['pull', image], 600_000);
  }

  private async generateKeypair(sandboxId: string): Promise<string> {
    const dir = this.keysDir(sandboxId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const keyPath = path.join(dir, 'id_ed25519');
    await execFileAsync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `runvane-${sandboxId}`, '-f', keyPath]);
    return keyPath;
  }

  /** Write the public key as the sandbox user's authorized_keys. */
  private async installAuthorizedKey(containerName: string, pubKeyPath: string): Promise<void> {
    const home = `/home/${SANDBOX_USER}`;
    const script =
      `mkdir -p ${home}/.ssh && cat > ${home}/.ssh/authorized_keys && ` +
      `chown -R ${SANDBOX_USER}:${SANDBOX_USER} ${home}/.ssh && ` +
      `chmod 700 ${home}/.ssh && chmod 600 ${home}/.ssh/authorized_keys`;
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        'docker',
        ['exec', '-i', '-u', 'root', containerName, 'sh', '-c', script],
        (err) => (err ? reject(err) : resolve()),
      );
      createReadStream(pubKeyPath).pipe(child.stdin!);
    });
  }

  private keysDir(sandboxId: string): string {
    // Home, not the workspace: key material isn't repo litter, and workspace
    // mounts can be virtiofs/network shares whose metadata quirks break
    // ssh-keygen's create-then-write pattern.
    const base = process.env.RUNVANE_SANDBOX_DATA_DIR?.trim() || path.join(os.homedir(), '.runvane', 'sandboxes');
    return path.join(base, sandboxId);
  }

  private async docker(args: string[], timeoutMs = 60_000): Promise<string> {
    try {
      const { stdout } = await execFileAsync('docker', args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      throw new Error(`docker ${args[0]} failed: ${stderr || (err as Error).message}`);
    }
  }
}

/** Locate the in-repo sandbox image build context across our working dirs. */
function resolveSandboxImageDir(): string | null {
  const explicit = process.env.RUNVANE_SANDBOX_IMAGE_DIR?.trim();
  const candidates = [
    explicit,
    path.resolve(process.cwd(), 'sandbox'),
    path.resolve(process.cwd(), '..', 'sandbox'),
    '/workspace/sandbox',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'Dockerfile'))) return candidate;
  }
  return null;
}
