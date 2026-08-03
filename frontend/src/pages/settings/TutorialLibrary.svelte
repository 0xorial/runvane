<script lang="ts">
  import { TUTORIAL_LESSONS } from "@/lib/tutorial/lessons";
  import { isLessonCompleted, startTutorial } from "@/lib/tutorial/tutorialStore.svelte";

  const core = TUTORIAL_LESSONS.filter((l) => l.core);
  const extras = TUTORIAL_LESSONS.filter((l) => !l.core);

  // Read completion reactively per render — the store updates when a lesson
  // finishes, and this page is the natural place to see progress.
  function stateLabel(id: string): string {
    return isLessonCompleted(id) ? "Replay" : "Start";
  }
</script>

{#snippet lessonRow(lesson: (typeof TUTORIAL_LESSONS)[number], index: number | null)}
  <div
    class="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3"
    data-testid="tutorial-lesson-row"
    data-lesson-id={lesson.id}
    data-completed={isLessonCompleted(lesson.id)}
  >
    <span
      class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold {isLessonCompleted(lesson.id)
        ? 'bg-primary text-primary-foreground'
        : 'bg-secondary/60 text-muted-foreground'}"
    >
      {#if isLessonCompleted(lesson.id)}
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      {:else if index != null}
        {index + 1}
      {:else}
        ·
      {/if}
    </span>
    <span class="min-w-0 flex-1">
      <span class="block text-sm font-medium text-foreground">{lesson.title}</span>
      <span class="block text-[12px] text-muted-foreground">{lesson.blurb}</span>
    </span>
    <button
      type="button"
      class="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground hover:bg-secondary/60"
      data-testid="tutorial-lesson-start"
      onclick={() => startTutorial(lesson.id)}
    >
      {stateLabel(lesson.id)}
    </button>
  </div>
{/snippet}

<div class="flex max-w-2xl flex-col gap-4" data-testid="tutorial-library">
  <div>
    <div class="mb-1.5 text-[13px] font-bold text-foreground">Getting started</div>
    <p class="mb-2 text-xs text-muted-foreground">
      A guided walk through the setup chain, on the real screens. Each lesson spotlights the part of
      the UI it explains — you can use the highlighted controls while it runs.
    </p>
    <div class="flex flex-col gap-2">
      {#each core as lesson, i (lesson.id)}
        {@render lessonRow(lesson, i)}
      {/each}
    </div>
  </div>
  <div>
    <div class="mb-1.5 text-[13px] font-bold text-foreground">More topics</div>
    <div class="flex flex-col gap-2">
      {#each extras as lesson (lesson.id)}
        {@render lessonRow(lesson, null)}
      {/each}
    </div>
  </div>
</div>
