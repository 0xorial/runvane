<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";

  let dark = $state(
    typeof localStorage !== "undefined" ? localStorage.getItem("theme") !== "light" : true,
  );

  $effect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  });
</script>

<button
  type="button"
  class="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  title={dark ? "Switch to light mode" : "Switch to dark mode"}
  aria-label="Toggle theme"
  onclick={() => (dark = !dark)}
>
  {#if dark}
    <Icon name="sun" class="h-4 w-4" />
  {:else}
    <Icon name="moon" class="h-4 w-4" />
  {/if}
</button>
