<script lang="ts">
  import { createToolEnvironment } from "@/api/client";
  import type { SshEnvironmentConfig, ToolEnvironment } from "../../../../backend/src/contracts/tool-environment";

  let {
    open,
    onOpenChange,
    onCreated,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (env: ToolEnvironment) => void | Promise<void>;
  } = $props();

  let name = $state("");
  let host = $state("");
  let user = $state("");
  let port = $state("");
  let identityFile = $state("");
  let remoteCommand = $state("");
  let saving = $state(false);
  let error = $state<string | null>(null);

  const canSave = $derived(name.trim().length > 0 && host.trim().length > 0);
  const inputClass = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground";

  function reset(): void {
    name = "";
    host = "";
    user = "";
    port = "";
    identityFile = "";
    remoteCommand = "";
    error = null;
  }

  function close(): void {
    reset();
    onOpenChange(false);
  }

  async function submit(): Promise<void> {
    if (!canSave || saving) return;
    saving = true;
    error = null;
    try {
      const portNum = parseInt(port.trim(), 10);
      const ssh: SshEnvironmentConfig = {
        host: host.trim(),
        ...(user.trim() ? { user: user.trim() } : {}),
        ...(Number.isFinite(portNum) && portNum > 0 ? { port: portNum } : {}),
        ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
        ...(remoteCommand.trim() ? { remoteCommand: remoteCommand.trim() } : {}),
      };
      const created = await createToolEnvironment({ name: name.trim(), ssh });
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
      <h2 id="add-env-title" class="mb-3 text-sm font-medium">New ssh environment</h2>

      {#if error}
        <div class="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
      {/if}

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

      <div class="mt-3 flex justify-end gap-2">
        <button type="button" class="rounded-md px-2 py-1 text-xs text-muted-foreground" onclick={close}>Cancel</button>
        <button
          type="button"
          class="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          data-testid="add-env-submit"
          disabled={!canSave || saving}
          onclick={() => void submit()}
        >
          {saving ? "Adding…" : "Add environment"}
        </button>
      </div>
    </div>
  </div>
{/if}
