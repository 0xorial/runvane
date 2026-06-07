<script lang="ts">
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
  class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
  title={dark ? "Switch to light mode" : "Switch to dark mode"}
  aria-label="Toggle theme"
  onclick={() => (dark = !dark)}
>
  {dark ? "☀" : "☾"}
</button>
