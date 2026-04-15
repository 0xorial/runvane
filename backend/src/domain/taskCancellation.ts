export class TaskCancelledError extends Error {
  constructor(message = "task cancelled by user") {
    super(message);
    this.name = "TaskCancelledError";
  }
}

export function throwIfCancelled(shouldCancel?: () => boolean): void {
  if (shouldCancel?.()) {
    throw new TaskCancelledError();
  }
}

export function isTaskCancelledError(value: unknown): value is TaskCancelledError {
  return value instanceof TaskCancelledError;
}
