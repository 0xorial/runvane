<script lang="ts">
  import { onMount } from "svelte";
  import { createToolSandbox, deleteToolSandbox, getToolSandboxes } from "@/api/client";
  import type { SshSandboxConfig, ToolSandbox } from "../../../../backend/src/contracts/tool-sandbox";
  import { ghostBtn, ghostDanger } from "./settingsClasses";

  let sandboxes = $state<ToolSandbox[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // New ssh sandbox form.
  let name = $state("");
  let host = $state("");
  let user = $state("");
  let port = $state("");
  let identityFile = $state("");
  let remoteCommand = $state("");
  let creating = $state(false);
  let busyId = $state<string | null>(null);

  const canCreate = $derived(name.trim().length > 0 && host.trim().length > 0);
  const inputClass = "w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-foreground";

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      sandboxes = await getToolSandboxes();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  onMount(load);

  async function create(): Promise<void> {
    if (!canCreate) return;
    creating = true;
    error = null;
    try {
      const portNum = parseInt(port.trim(), 10);
      const ssh: SshSandboxConfig = {
        host: host.trim(),
        ...(user.trim() ? { user: user.trim() } : {}),
        ...(Number.isFinite(portNum) && portNum > 0 ? { port: portNum } : {}),
        ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
        ...(remoteCommand.trim() ? { remoteCommand: remoteCommand.trim() } : {}),
      };
      await createToolSandbox({ name: name.trim(), ssh });
      name = "";
      host = "";
      user = "";
      port = "";
      identityFile = "";
      remoteCommand = "";
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      creating = false;
    }
  }

  async function remove(id: string): Promise<void> {
    busyId = id;
    error = null;
    try {
      await deleteToolSandbox(id);
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = null;
    }
  }
</script>

<main class="flex min-w-0 flex-col gap-3.5" data-testid="tool-sandboxes-section">
  <div>
    <h1 class="text-base font-bold text-foreground">Tool sandboxes</h1>
    <p class="text-xs text-muted-foreground">
      Where a conversation's runtime tools run. <strong>Local</strong> and <strong>None</strong> are
      built in; add ssh hosts to run the tool-host on another machine. Pick one per chat on the
      new-chat screen.
    </p>
  </div>

  {#if error}
    <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert" data-testid="tool-env-error">
      {error}
    </div>
  {/if}

  <section class="rounded-lg border border-border bg-card p-3">
    <div class="mb-2 text-[13px] font-bold text-foreground">New ssh sandbox</div>
    <div class="grid grid-cols-2 gap-2.5">
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Name</span>
        <input class={inputClass} data-testid="tool-env-name" bind:value={name} placeholder="Build box" />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Host</span>
        <input class={inputClass} data-testid="tool-env-host" bind:value={host} placeholder="box.local" />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">User (optional)</span>
        <input class={inputClass} data-testid="tool-env-user" bind:value={user} placeholder="dev" />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Port (optional)</span>
        <input class={inputClass} data-testid="tool-env-port" bind:value={port} placeholder="22" inputmode="numeric" />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Identity file (optional)</span>
        <input class={inputClass} data-testid="tool-env-identity" bind:value={identityFile} placeholder="~/.ssh/id_ed25519" />
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold text-foreground">Remote command (optional)</span>
        <input class={inputClass} data-testid="tool-env-remote" bind:value={remoteCommand} placeholder="runvane-toolhost" />
      </label>
    </div>
    <div class="mt-2.5">
      <button type="button" class="{ghostBtn} border-slate-300" data-testid="tool-env-create" disabled={!canCreate || creating} onclick={create}>
        {creating ? "Adding…" : "Add sandbox"}
      </button>
    </div>
  </section>

  {#if loading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else}
    <div class="flex flex-col gap-2.5">
      {#each sandboxes as env (env.id)}
        <section class="rounded-lg border border-border bg-card p-3" data-testid="tool-env-row" data-env-id={env.id}>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-bold text-foreground">
                {env.name}
                {#if env.builtin}
                  <span class="ml-1 rounded bg-muted px-1 text-[10px] font-medium uppercase text-muted-foreground">built-in</span>
                {/if}
              </div>
              <div class="text-xs text-muted-foreground">
                <code>{env.kind}</code>
                {#if env.ssh}
                  · {env.ssh.user ? `${env.ssh.user}@` : ""}{env.ssh.host}{env.ssh.port ? `:${env.ssh.port}` : ""}
                {/if}
              </div>
              <div class="mt-0.5 text-[11px] text-muted-foreground">id: <code>{env.id}</code></div>
            </div>
            {#if !env.builtin}
              <button type="button" class="{ghostBtn} {ghostDanger} shrink-0" data-testid="tool-env-delete" disabled={busyId === env.id} onclick={() => remove(env.id)}>
                Delete
              </button>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</main>
