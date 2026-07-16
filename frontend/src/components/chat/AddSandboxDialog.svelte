<script lang="ts">
  import { createDockerSandbox, createToolSandbox } from "@/api/client";
  import type { SshSandboxConfig, ToolSandbox } from "../../../../backend/src/contracts/tool-sandbox";

  let {
    open,
    onOpenChange,
    onCreated,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (env: ToolSandbox) => void | Promise<void>;
  } = $props();

  // Docker: runvane makes the box (container from the sandbox image, key
  // installed, registered over ssh). SSH: an existing machine the user
  // already has access to.
  let mode = $state<"docker" | "ssh">("docker");

  let name = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);

  // ssh fields
  let host = $state("");
  let user = $state("");
  let port = $state("");
  let identityFile = $state("");
  let remoteCommand = $state("");

  // docker fields
  let image = $state("");
  type MountRow = { host: string; container: string; readonly: boolean };
  let mounts = $state<MountRow[]>([]);

  // Docker: half-filled mount rows block saving (complete them or clear them);
  // fully empty rows are simply dropped at submit.
  const canSave = $derived(
    name.trim().length > 0 &&
      (mode === "docker"
        ? mounts.every((m) => Boolean(m.host.trim()) === Boolean(m.container.trim()))
        : host.trim().length > 0),
  );
  const inputClass = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground";
  const segment = "px-2.5 py-1 text-xs font-medium transition-colors";

  function reset(): void {
    mode = "docker";
    name = "";
    host = "";
    user = "";
    port = "";
    identityFile = "";
    remoteCommand = "";
    image = "";
    mounts = [];
    error = null;
  }

  function close(): void {
    reset();
    onOpenChange(false);
  }

  function addMount(): void {
    mounts = [...mounts, { host: "", container: "", readonly: false }];
  }

  function removeMount(index: number): void {
    mounts = mounts.filter((_, i) => i !== index);
  }

  async function submit(): Promise<void> {
    if (!canSave || saving) return;
    saving = true;
    error = null;
    try {
      let created: ToolSandbox;
      if (mode === "docker") {
        const cleanMounts = mounts
          .filter((m) => m.host.trim() && m.container.trim())
          .map((m) => ({
            host: m.host.trim(),
            container: m.container.trim(),
            ...(m.readonly ? { readonly: true } : {}),
          }));
        created = await createDockerSandbox({
          name: name.trim(),
          ...(image.trim() ? { image: image.trim() } : {}),
          mounts: cleanMounts,
        });
      } else {
        const portNum = parseInt(port.trim(), 10);
        const ssh: SshSandboxConfig = {
          host: host.trim(),
          ...(user.trim() ? { user: user.trim() } : {}),
          ...(Number.isFinite(portNum) && portNum > 0 ? { port: portNum } : {}),
          ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
          ...(remoteCommand.trim() ? { remoteCommand: remoteCommand.trim() } : {}),
        };
        created = await createToolSandbox({ name: name.trim(), ssh });
      }
      reset();
      onOpenChange(false);
      await onCreated(created);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-env-title"
      class="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
      data-testid="add-env-dialog"
    >
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 id="add-env-title" class="text-sm font-medium">New sandbox</h2>
        <div class="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Sandbox type">
          <button
            type="button"
            data-testid="add-env-mode-docker"
            aria-pressed={mode === "docker"}
            class="{segment} {mode === 'docker' ? 'bg-primary/15 font-semibold text-primary' : 'text-muted-foreground hover:bg-secondary/60'}"
            onclick={() => (mode = "docker")}
          >
            Docker
          </button>
          <button
            type="button"
            data-testid="add-env-mode-ssh"
            aria-pressed={mode === "ssh"}
            class="{segment} border-l border-border {mode === 'ssh' ? 'bg-primary/15 font-semibold text-primary' : 'text-muted-foreground hover:bg-secondary/60'}"
            onclick={() => (mode = "ssh")}
          >
            SSH
          </button>
        </div>
      </div>

      {#if error}
        <div class="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
      {/if}

      {#if mode === "docker"}
        <p class="mb-2.5 text-xs text-muted-foreground">
          Runvane creates a container from the sandbox image (common dev tooling), connects to it over ssh,
          and runs tools inside it. Deleting the sandbox removes the container.
        </p>
        <div class="grid grid-cols-2 gap-2.5">
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Name</span>
            <input class={inputClass} data-testid="add-env-name" bind:value={name} placeholder="Scratch box" />
          </label>
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Image (optional)</span>
            <input class={inputClass} bind:value={image} placeholder="runvane-sandbox:latest" />
          </label>
        </div>
        <div class="mt-2.5">
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs font-semibold text-foreground">Mounts from the harness host</span>
            <button
              type="button"
              data-testid="add-env-add-mount"
              class="rounded-md px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10"
              onclick={addMount}
            >
              + add mount
            </button>
          </div>
          {#if mounts.length === 0}
            <p class="text-xs text-muted-foreground">None — the sandbox starts with an empty /workspace.</p>
          {:else}
            <div class="space-y-1.5">
              {#each mounts as mount, i (i)}
                <div class="flex items-center gap-1.5">
                  <input
                    class={inputClass}
                    data-testid="add-env-mount-host"
                    bind:value={mount.host}
                    placeholder="/host/path"
                  />
                  <span class="text-xs text-muted-foreground">→</span>
                  <input
                    class={inputClass}
                    data-testid="add-env-mount-container"
                    bind:value={mount.container}
                    placeholder="/workspace/project"
                  />
                  <label class="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title="Mount read-only">
                    <input type="checkbox" bind:checked={mount.readonly} />
                    ro
                  </label>
                  <button
                    type="button"
                    class="shrink-0 rounded px-1 text-xs text-muted-foreground hover:text-destructive"
                    aria-label="Remove mount"
                    onclick={() => removeMount(i)}
                  >
                    ✕
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <div class="grid grid-cols-2 gap-2.5">
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Name</span>
            <input class={inputClass} data-testid="add-env-name" bind:value={name} placeholder="Build box" />
          </label>
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Host</span>
            <input class={inputClass} bind:value={host} placeholder="box.local" />
          </label>
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">User (optional)</span>
            <input class={inputClass} bind:value={user} placeholder="dev" />
          </label>
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Port (optional)</span>
            <input class={inputClass} bind:value={port} placeholder="22" inputmode="numeric" />
          </label>
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Identity file (optional)</span>
            <input class={inputClass} bind:value={identityFile} placeholder="~/.ssh/id_ed25519" />
          </label>
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-semibold text-foreground">Remote command (optional)</span>
            <input class={inputClass} bind:value={remoteCommand} placeholder="blank = auto-deploy the host" />
          </label>
        </div>
      {/if}

      <div class="mt-3 flex justify-end gap-2">
        <button type="button" class="rounded-md px-2 py-1 text-xs text-muted-foreground" onclick={close}>Cancel</button>
        <button
          type="button"
          class="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          data-testid="add-env-submit"
          disabled={!canSave || saving}
          onclick={() => void submit()}
        >
          {saving ? (mode === "docker" ? "Creating container…" : "Adding…") : "Add sandbox"}
        </button>
      </div>
    </div>
  </div>
{/if}
