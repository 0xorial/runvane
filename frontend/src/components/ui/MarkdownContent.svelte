<script lang="ts">
  import { proseChat, renderMarkdownHtml } from "@/lib/markdown";

  let { content, class: className = "" }: { content: string; class?: string } = $props();

  const html = $derived(renderMarkdownHtml(content));
</script>

<!-- eslint-disable svelte/no-at-html-tags -->
<div class="{proseChat} {className}">
  <!-- links open in new tab via post-sanitize hook -->
  {@html html.replace(/<a /g, '<a target="_blank" rel="noreferrer noopener" ')}
</div>
