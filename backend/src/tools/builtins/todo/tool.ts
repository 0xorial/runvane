import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import { summarizeTodos } from '../../../contracts/todo.js';
import { BaseTool, type ToolPolicy } from '../../base-tool.js';
import { parseTodoWriteToolParams, todoWriteParamsSchema, type TodoWriteToolParams } from './params.js';
import { TodoWriteToolRulesSchema, parseTodoWriteToolRules, type TodoWriteToolRules } from './rules.js';

/**
 * Records the agent's evolving to-do list to keep a multi-step task on track —
 * the runvane equivalent of Claude Code's TodoWrite. The tool is deliberately
 * stateless: the accepted list lives on this call's `tool-invocation` chat
 * entry (`parameters.todos`), and the UI derives the current list from the most
 * recent such entry on the active branch. runTool only validates and echoes the
 * list back with a rollup summary — there is nothing else to persist.
 */
@Injectable()
export class TodoWriteTool extends BaseTool<TodoWriteToolParams, TodoWriteToolRules> {
  getName(): string {
    return 'todo_write';
  }

  getAiDescription(): string {
    return (
      'Maintain a structured to-do list to plan and track progress on a multi-step task, and to show the user the plan. ' +
      'Send the COMPLETE list every call — it replaces the previous list wholesale. ' +
      'Each item is { content, status: pending|in_progress|completed, activeForm? }. ' +
      'Keep exactly one item in_progress at a time; mark an item completed as soon as it is done before starting the next. ' +
      'Use it for non-trivial multi-step work; skip it for a single trivial step.'
    );
  }

  getHumanDescription(): string {
    return 'Track a to-do list for the current task.';
  }

  getParamsSchema(): unknown {
    return todoWriteParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(TodoWriteToolRulesSchema);
  }

  getDefaultRules(): TodoWriteToolRules {
    return {};
  }

  getDefaultPolicy(): ToolPolicy {
    // Pure bookkeeping — no side effects, so it never needs an approval prompt.
    return 'allow';
  }

  parseParams(raw: unknown): TodoWriteToolParams {
    return parseTodoWriteToolParams(raw);
  }

  parseRules(raw: unknown): TodoWriteToolRules {
    return parseTodoWriteToolRules(raw);
  }

  runTool(params: TodoWriteToolParams): unknown {
    const inProgress = params.todos.filter((t) => t.status === 'in_progress');
    if (inProgress.length > 1) {
      throw new Error(
        `todo_write: at most one item may be in_progress at a time (got ${inProgress.length}). ` +
          'Mark the others pending or completed.',
      );
    }
    return { todos: params.todos, summary: summarizeTodos(params.todos) };
  }
}
