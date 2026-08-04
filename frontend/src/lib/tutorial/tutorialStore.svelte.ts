import { tutorialLessonById, type TutorialLesson } from './lessons';

// Runes-based tutorial state (same module-level pattern as tasksStore).
// Completion, seen tips, and the mute flag persist in localStorage; the
// active lesson/step is session-only.

const STORAGE_KEY = 'runvane.tutorial.v1';

type StoredProgress = {
  completed: Record<string, boolean>;
  seenTips: Record<string, boolean>;
  /** Muted: no auto-started lessons and no contextual tips. Lessons stay
   *  manually startable from the library. */
  skipped: boolean;
};

function loadProgress(): StoredProgress {
  const fallback: StoredProgress = { completed: {}, seenTips: {}, skipped: false };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredProgress>) : null;
    if (parsed && typeof parsed === 'object') {
      return {
        completed: parsed.completed && typeof parsed.completed === 'object' ? parsed.completed : {},
        seenTips: parsed.seenTips && typeof parsed.seenTips === 'object' ? parsed.seenTips : {},
        skipped: parsed.skipped === true,
      };
    }
  } catch {
    /* corrupt storage — start fresh */
  }
  return fallback;
}

const initial = loadProgress();
let activeLesson = $state<TutorialLesson | null>(null);
let stepIndex = $state(0);
let completed = $state<Record<string, boolean>>(initial.completed);
let seenTips = $state<Record<string, boolean>>(initial.seenTips);
let skipped = $state<boolean>(initial.skipped);
// First-open auto-start fires at most once per session, so exiting the
// auto-started lesson doesn't immediately re-trigger it.
let autoStartAttempted = false;

function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed, seenTips, skipped }));
  } catch {
    /* storage unavailable — progress just won't survive reload */
  }
}

export function tutorialActiveLesson(): TutorialLesson | null {
  return activeLesson;
}

export function tutorialStepIndex(): number {
  return stepIndex;
}

export function isLessonCompleted(id: string): boolean {
  return completed[id] === true;
}

export function tutorialSkipped(): boolean {
  return skipped;
}

export function setTutorialSkipped(value: boolean): void {
  skipped = value;
  persist();
}

export function isTipSeen(id: string): boolean {
  return seenTips[id] === true;
}

export function markTipSeen(id: string): void {
  seenTips = { ...seenTips, [id]: true };
  persist();
}

export function startTutorial(lessonId: string): void {
  const lesson = tutorialLessonById(lessonId);
  if (!lesson || lesson.steps.length === 0) return;
  activeLesson = lesson;
  stepIndex = 0;
}

/**
 * True first open: nothing completed, nothing muted — start the first lesson.
 * Called by the setup guide when the core chain is actually broken (the state
 * a fresh install boots into). At most once per session.
 */
export function maybeAutoStartTutorial(): void {
  if (autoStartAttempted) return;
  autoStartAttempted = true;
  if (skipped || activeLesson) return;
  if (Object.keys(completed).length > 0) return;
  startTutorial('connect-model');
}

export function exitTutorial(): void {
  activeLesson = null;
  stepIndex = 0;
}

/** The "Skip tutorial" button: mute auto-starts and tips, close the overlay. */
export function skipTutorialCompletely(): void {
  setTutorialSkipped(true);
  exitTutorial();
}

export function backTutorialStep(): void {
  if (stepIndex > 0) stepIndex -= 1;
}

/** Advance; finishing the last step marks the lesson completed and exits. */
export function nextTutorialStep(): void {
  const lesson = activeLesson;
  if (!lesson) return;
  if (stepIndex < lesson.steps.length - 1) {
    stepIndex += 1;
    return;
  }
  completed = { ...completed, [lesson.id]: true };
  persist();
  exitTutorial();
}
