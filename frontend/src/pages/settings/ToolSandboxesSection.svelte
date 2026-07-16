<script lang="ts">
  import { onMount } from "svelte";
  import { createToolSandbox, deleteToolSandbox, getToolSandboxes, updateToolSandbox } from "@/api/client";
  import type { SshSandboxConfig, ToolSandbox } from "../../../../backend/src/contracts/tool-sandbox";
  import SandboxDetails from "@/components/chat/SandboxDetails.svelte";
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
  let showCreate = $state(false);

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
      showCreate = false;
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

  // Per-row details view + rename (docker specifics are fixed at creation —
  // shown read-only with the recreate note).
  let expandedId = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let renameValue = $state("");

  function startRename(env: ToolSandbox): void {
    renamingId = env.id;
    renameValue = env.name;
  }

  async function saveRename(env: ToolSandbox): Promise<void> {
    const next = renameValue.trim();
    if (!next || !env.ssh) return;
    busyId = env.id;
    error = null;
    try {
      await updateToolSandbox(env.id, { name: next, ssh: env.ssh });
      renamingId = null;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyId = null;
    }
  }
</script>

<main class="flex min-w-0 flex-col gap-3.5" data-testid="tool-sandboxes-section">
  {#if error}
    <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert" data-testid="tool-env-error">
      {error}
    </div>
  {/if}

  {#if loading}
    <p class="text-sm text-muted-foreground">Loading…</p>
  {:else}
    <div class="flex flex-col gap-2.5">
      {#each sandboxes as env (env.id)}
        <section class="rounded-lg border border-border bg-card p-3" data-testid="tool-env-row" data-env-id={env.id}>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-bold text-foreground">
                {#if renamingId === env.id}
                  <span class="flex items-center gap-1.5">
                    <input
                      class="{inputClass} max-w-56"
                      data-testid="tool-env-rename-input"
                      bind:value={renameValue}
                      onkeydown={(e) => e.key === "Enter" && void saveRename(env)}
                    />
                    <button type="button" class={ghostBtn} data-testid="tool-env-rename-save" disabled={busyId === env.id} onclick={() => void saveRename(env)}>Save</button>
                    <button type="button" class={ghostBtn} onclick={() => (renamingId = null)}>Cancel</button>
                  </span>
                {:else}
                  {env.name}
                  {#if env.builtin}
                    <span class="ml-1 rounded bg-muted px-1 text-[10px] font-medium uppercase text-muted-foreground">built-in</span>
                  {/if}
                  {#if env.docker}
                    <span class="ml-1 rounded bg-muted px-1 text-[10px] font-medium uppercase text-muted-foreground">docker</span>
                  {/if}
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
            <div class="flex shrink-0 items-center gap-1.5">
              {#if !env.builtin}
                <button
                  type="button"
                  class={ghostBtn}
                  data-testid="tool-env-details"
                  aria-expanded={expandedId === env.id}
                  onclick={() => (expandedId = expandedId === env.id ? null : env.id)}
                >
                  {expandedId === env.id ? "Hide details" : "Details"}
                </button>
                <button type="button" class={ghostBtn} data-testid="tool-env-rename" onclick={() => startRename(env)}>
                  Rename
                </button>
                <button type="button" class="{ghostBtn} {ghostDanger}" data-testid="tool-env-delete" disabled={busyId === env.id} onclick={() => remove(env.id)}>
                  Delete
                </button>
              {/if}
            </div>
          </div>
          {#if expandedId === env.id}
            <div class="mt-2 border-t border-border/60 pt-2">
              <SandboxDetails {env} />
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}

  {#if !showCreate}
    <div>
      <button type="button" class={ghostBtn} data-testid="tool-env-add" onclick={() => (showCreate = true)}>
        + Add ssh sandbox
      </button>
    </div>
  {:else}
    <section class="rounded-lg border border-border bg-card p-3">
      <div class="mb-2 flex items-center justify-between">
        <div class="text-[13px] font-bold text-foreground">New ssh sandbox</div>
        <button type="button" class="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Close new-sandbox form" onclick={() => (showCreate = false)}>
          ✕
        </button>
      </div>
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
  {/if}
</main>
