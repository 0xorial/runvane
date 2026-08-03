import { tutorialLessonById, type TutorialLesson } from './lessons';

// Runes-based tutorial state (same module-level pattern as tasksStore).
// Completion persists in localStorage so the library shows what's been seen
// across sessions; the active lesson/step is session-only.

const STORAGE_KEY = 'runvane.tutorial.v1';

type StoredProgress = { completed: Record<string, boolean> };

function loadProgress(): StoredProgress {
  if (typeof window === 'undefined') return { completed: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredProgress) : null;
    if (parsed && typeof parsed === 'object' && parsed.completed && typeof parsed.completed === 'object') {
      return { completed: parsed.completed };
    }
  } catch {
    /* corrupt storage — start fresh */
  }
  return { completed: {} };
}

let activeLesson = $state<TutorialLesson | null>(null);
let stepIndex = $state(0);
let completed = $state<Record<string, boolean>>(loadProgress().completed);

function persist(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ completed }));
  } catch {
    /* storage unavailable — completion just won't survive reload */
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

export function startTutorial(lessonId: string): void {
  const lesson = tutorialLessonById(lessonId);
  if (!lesson || lesson.steps.length === 0) return;
  activeLesson = lesson;
  stepIndex = 0;
}

export function exitTutorial(): void {
  activeLesson = null;
  stepIndex = 0;
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
