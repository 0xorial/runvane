export class TaskCancelledError extends Error {
  constructor(message = "task cancelled by user") {
    super(message);
    this.name = "TaskCancelledError";
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new TaskCancelledError();
  }
}

export function isTaskCancelledError(value: unknown): value is TaskCancelledError {
  return value instanceof TaskCancelledError;
}
