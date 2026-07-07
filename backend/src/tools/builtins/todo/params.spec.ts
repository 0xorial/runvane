import { parseTodoWriteToolParams } from './params.js';
import { TodoWriteTool } from './tool.js';

describe('todo_write params', () => {
  it('accepts a well-formed list with optional activeForm', () => {
    const parsed = parseTodoWriteToolParams({
      todos: [
        { content: 'Write the migration', status: 'completed' },
        { content: 'Wire the UI', status: 'in_progress', activeForm: 'Wiring the UI' },
        { content: 'Add tests', status: 'pending' },
      ],
    });
    expect(parsed.todos).toHaveLength(3);
    expect(parsed.todos[1].activeForm).toBe('Wiring the UI');
  });

  it('rejects unknown keys and bad status', () => {
    expect(() => parseTodoWriteToolParams({ todos: [{ content: 'x', status: 'done' }] })).toThrow();
    expect(() => parseTodoWriteToolParams({ todos: [{ content: 'x', status: 'pending', extra: 1 }] })).toThrow();
    expect(() => parseTodoWriteToolParams({ todos: [{ content: '', status: 'pending' }] })).toThrow();
  });
});

describe('todo_write tool', () => {
  const tool = new TodoWriteTool();

  it('echoes the list with a rollup summary', () => {
    const out = tool.runTool({
      todos: [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ],
    }) as { todos: unknown[]; summary: { total: number; completed: number; inProgress: number; pending: number } };
    expect(out.summary).toEqual({ total: 3, completed: 1, inProgress: 1, pending: 1 });
    expect(out.todos).toHaveLength(3);
  });

  it('rejects more than one in_progress item', () => {
    expect(() =>
      tool.runTool({
        todos: [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'in_progress' },
        ],
      }),
    ).toThrow(/at most one item may be in_progress/);
  });
});
