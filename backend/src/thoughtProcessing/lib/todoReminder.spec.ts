import { describe, expect, it } from '@jest/globals';
import type { ChatEntry, ToolState } from '../../contracts/chatEntry.js';
import type { TodoItem } from '../../contracts/todo.js';
import { buildPlannerMessages } from './plannerPrompt.js';
import { buildTodoReminder, deriveCurrentTodos, TODO_REMINDER_AFTER_ENTRIES } from './todoReminder.js';

let nextIndex = 0;
function base(): { id: string; conversationIndex: number; createdAt: string; parentId: string | null; isSide: boolean } {
  nextIndex++;
  return {
    id: `e${nextIndex}`,
    conversationIndex: nextIndex,
    createdAt: new Date(0).toISOString(),
    parentId: null,
    isSide: false,
  };
}

function userMsg(): ChatEntry {
  return { ...base(), type: 'user-message', text: 'hi', agentId: 'a1' } as ChatEntry;
}

function assistantMsg(): ChatEntry {
  return { ...base(), type: 'assistant-message', text: 'ok' } as ChatEntry;
}

function todoWrite(todos: TodoItem[] | unknown, state: ToolState = 'done'): ChatEntry {
  return {
    ...base(),
    type: 'tool-invocation',
    toolId: 'todo_write',
    state,
    parameters: { todos },
  } as ChatEntry;
}

function otherTool(): ChatEntry {
  return { ...base(), type: 'tool-invocation', toolId: 'get_current_time', state: 'done', parameters: {} } as ChatEntry;
}

const TODOS: TodoItem[] = [
  { content: 'Explore', status: 'completed' },
  { content: 'Implement', status: 'in_progress' },
  { content: 'Test', status: 'pending' },
];

function pad(count: number): ChatEntry[] {
  return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? assistantMsg() : userMsg()));
}

describe('deriveCurrentTodos', () => {
  it('returns null when no todo_write exists', () => {
    expect(deriveCurrentTodos([userMsg(), assistantMsg(), otherTool()])).toBeNull();
  });

  it('returns the latest usable list and the distance to the tail', () => {
    const derived = deriveCurrentTodos([userMsg(), todoWrite(TODOS), assistantMsg(), userMsg(), otherTool()]);
    expect(derived?.todos).toHaveLength(3);
    expect(derived?.entriesSince).toBe(3);
  });

  it('skips denied/errored writes — the prior accepted list stands', () => {
    const older: TodoItem[] = [{ content: 'Old plan', status: 'pending' }];
    const derived = deriveCurrentTodos([userMsg(), todoWrite(older), assistantMsg(), todoWrite(TODOS, 'denied')]);
    expect(derived?.todos).toEqual(older);
  });

  it('treats an accepted empty list as cleared', () => {
    expect(deriveCurrentTodos([userMsg(), todoWrite(TODOS), todoWrite([])])).toBeNull();
  });

  it('ignores unparsable todos params', () => {
    expect(deriveCurrentTodos([userMsg(), todoWrite('garbage')])).toBeNull();
  });

  it('does not count thought entries toward the distance', () => {
    const thought = { ...base(), type: 'thought' } as unknown as ChatEntry;
    const derived = deriveCurrentTodos([userMsg(), todoWrite(TODOS), thought, thought, assistantMsg()]);
    expect(derived?.entriesSince).toBe(1);
  });
});

describe('buildTodoReminder', () => {
  it('stays silent while the list is fresh', () => {
    const entries = [userMsg(), todoWrite(TODOS), ...pad(TODO_REMINDER_AFTER_ENTRIES - 1)];
    expect(buildTodoReminder(entries)).toBeNull();
  });

  it('fires once the list is stale, rendering every item with its status', () => {
    const entries = [userMsg(), todoWrite(TODOS), ...pad(TODO_REMINDER_AFTER_ENTRIES)];
    const reminder = buildTodoReminder(entries);
    expect(reminder).toContain('current to-do list');
    expect(reminder).toContain('- [completed] Explore');
    expect(reminder).toContain('- [in_progress] Implement');
    expect(reminder).toContain('- [pending] Test');
    expect(reminder).toContain('todo_write');
  });

  it('stays silent when everything is completed', () => {
    const done: TodoItem[] = TODOS.map((t) => ({ ...t, status: 'completed' as const }));
    const entries = [userMsg(), todoWrite(done), ...pad(TODO_REMINDER_AFTER_ENTRIES)];
    expect(buildTodoReminder(entries)).toBeNull();
  });

  it('stays silent when there is no list at all', () => {
    expect(buildTodoReminder([userMsg(), ...pad(TODO_REMINDER_AFTER_ENTRIES)])).toBeNull();
  });
});

describe('buildPlannerMessages todo reminder', () => {
  const staleEntries = () => [userMsg(), todoWrite(TODOS), ...pad(TODO_REMINDER_AFTER_ENTRIES)];
  const todoTool = { name: 'todo_write', description: 'Track to-dos.', operations: [] };

  it('appends the reminder as a trailing system message when todo_write is available', () => {
    const messages = buildPlannerMessages({ systemPrompt: 'sys', entries: staleEntries(), tools: [todoTool] });
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('system');
    expect(JSON.stringify(last)).toContain('current to-do list');
  });

  it('omits the reminder when todo_write is not among the enabled tools', () => {
    const messages = buildPlannerMessages({ systemPrompt: 'sys', entries: staleEntries(), tools: [] });
    expect(JSON.stringify(messages)).not.toContain('current to-do list');
  });
});
