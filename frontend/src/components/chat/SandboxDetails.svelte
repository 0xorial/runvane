<script lang="ts">
  import type { ToolSandbox } from "../../../../backend/src/contracts/tool-sandbox";

  // The full configuration of one sandbox, shared by the settings rows and
  // the new-chat inline panel: docker specifics (image, container, mounts)
  // and the ssh connection (target, identity, transport).
  let { env }: { env: ToolSandbox } = $props();
</script>

<div class="space-y-2 text-xs" data-testid="tool-env-detail-panel">
  {#if env.docker}
    <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <span class="text-muted-foreground">Image</span>
      <code class="break-all text-foreground" data-testid="tool-env-detail-image">{env.docker.image}</code>
      <span class="text-muted-foreground">Container</span>
      <code class="break-all text-foreground">{env.docker.containerName}</code>
    </div>
    <div>
      <div class="mb-0.5 font-semibold text-foreground">Mounts</div>
      {#if env.docker.mounts.length === 0}
        <p class="text-muted-foreground">None — the sandbox workspace started empty.</p>
      {:else}
        <div class="space-y-0.5">
          {#each env.docker.mounts as mount (mount.host + mount.container)}
            <div class="flex flex-wrap items-center gap-1.5" data-testid="tool-env-detail-mount">
              <code class="break-all">{mount.host}</code>
              <span class="text-muted-foreground">→</span>
              <code class="break-all">{mount.container}</code>
              {#if mount.readonly}
                <span class="rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">ro</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
      <p class="mt-1 text-[11px] text-muted-foreground">
        Image and mounts are fixed at creation — delete the sandbox and recreate it to change them.
      </p>
    </div>
  {/if}
  {#if env.ssh}
    <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <span class="text-muted-foreground">SSH target</span>
      <code class="break-all text-foreground">{env.ssh.user ? `${env.ssh.user}@` : ""}{env.ssh.host}{env.ssh.port ? `:${env.ssh.port}` : ""}</code>
      {#if env.ssh.identityFile}
        <span class="text-muted-foreground">Identity file</span>
        <code class="break-all text-foreground">{env.ssh.identityFile}</code>
      {/if}
      {#if env.ssh.remoteCommand}
        <span class="text-muted-foreground">Remote command</span>
        <code class="break-all text-foreground">{env.ssh.remoteCommand}</code>
      {/if}
      {#if env.ssh.proxyCommand}
        <span class="text-muted-foreground">Transport</span>
        <code class="break-all text-foreground">{env.ssh.proxyCommand}</code>
      {/if}
    </div>
  {/if}
</div>
