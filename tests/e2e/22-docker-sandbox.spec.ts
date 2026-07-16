import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { apiBaseUrl } from "./harness/client";
import { expect, test } from "./fixtures";

const execFileAsync = promisify(execFile);

const runE2e = process.env.RUN_E2E_TESTS === "1";
test.skip(!runE2e, "Set RUN_E2E_TESTS=1 with backend+frontend running");

/**
 * Docker-sandbox lifecycle against a REAL daemon: create → container exists +
 * row registered as ssh-over-docker-exec → delete → both gone. Toolhost
 * connectivity is NOT asserted here (it needs the full sandbox image with
 * node/sshd — heavyweight to build in CI); a tiny local image with just a
 * `dev` user stands in, exercising create/keys/mounts/teardown end to end.
 */

const TEST_IMAGE = "runvane-e2e-sandbox:tiny";

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function ensureTinyImage(): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "e2e-sbx-image-"));
  try {
    await writeFile(
      path.join(dir, "Dockerfile"),
      // Enough for create(): a shell for the authorized_keys install and a
      // `dev` user with a home. No sshd/node — connectivity is out of scope.
      "FROM alpine:3.20\nRUN adduser -D -u 1000 dev\nCMD [\"sleep\", \"infinity\"]\n",
    );
    await execFileAsync("docker", ["build", "-t", TEST_IMAGE, dir], { timeout: 120_000 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function containerExists(name: string): Promise<boolean> {
  const { stdout } = await execFileAsync("docker", ["ps", "-a", "--filter", `name=^${name}$`, "--format", "{{.Names}}"]);
  return stdout.trim() === name;
}

test("docker sandbox: create registers an ssh-over-docker-exec row; delete removes the container", async ({
  request,
}) => {
  test.setTimeout(120_000);
  test.skip(!(await dockerAvailable()), "docker daemon not reachable from the harness");
  await ensureTinyImage();

  const hostDir = await mkdtemp(path.join(os.tmpdir(), "e2e-sbx-mount-"));
  let sandboxId: string | null = null;
  try {
    const createRes = await request.post(`${apiBaseUrl()}/api/tool-sandboxes/docker`, {
      data: {
        name: `e2e docker sandbox`,
        image: TEST_IMAGE,
        mounts: [{ host: hostDir, container: "/workspace/mounted", readonly: true }],
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as {
      id: string;
      kind: string;
      ssh: { host: string; user?: string; identityFile?: string; proxyCommand?: string; remoteCommand?: string };
      docker: { containerName: string; image: string; mounts: unknown[] } | null;
    };
    sandboxId = created.id;

    // Registered as plain ssh riding docker exec; docker metadata records
    // what to tear down.
    expect(created.kind).toBe("ssh");
    expect(created.docker?.image).toBe(TEST_IMAGE);
    expect(created.docker?.mounts).toHaveLength(1);
    expect(created.ssh.user).toBe("dev");
    expect(created.ssh.proxyCommand).toContain(`docker exec -i -u root ${created.docker!.containerName}`);
    expect(created.ssh.remoteCommand).toBeUndefined();
    expect(created.ssh.identityFile).toBeTruthy();

    // The container actually runs, with the mount and the installed key.
    expect(await containerExists(created.docker!.containerName)).toBe(true);
    const { stdout: keys } = await execFileAsync("docker", [
      "exec",
      created.docker!.containerName,
      "cat",
      "/home/dev/.ssh/authorized_keys",
    ]);
    expect(keys).toContain("ssh-ed25519");
    const { stdout: mountLine } = await execFileAsync("docker", [
      "exec",
      created.docker!.containerName,
      "sh",
      "-c",
      "grep /workspace/mounted /proc/mounts",
    ]);
    expect(mountLine).toContain("ro");

    // Listed among sandboxes (what the new-chat cards render).
    const listRes = await request.get(`${apiBaseUrl()}/api/tool-sandboxes`);
    const { sandboxes } = (await listRes.json()) as { sandboxes: Array<{ id: string }> };
    expect(sandboxes.some((s) => s.id === created.id)).toBe(true);

    // Delete tears the container down with the row.
    const delRes = await request.delete(`${apiBaseUrl()}/api/tool-sandboxes/${created.id}`);
    expect(delRes.ok()).toBeTruthy();
    sandboxId = null;
    expect(await containerExists(created.docker!.containerName)).toBe(false);
  } finally {
    if (sandboxId) await request.delete(`${apiBaseUrl()}/api/tool-sandboxes/${sandboxId}`).catch(() => {});
    await rm(hostDir, { recursive: true, force: true });
  }
});
