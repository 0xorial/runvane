import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import type { ChatEntry } from '../../../contracts/chatEntry.js';
import { AgentsRepo } from '../../../db/repositories/agents.repo.js';
import { ChatEntriesRepo } from '../../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../../db/repositories/conversations.repo.js';
import { BaseTool, type ToolRunContext } from '../../base-tool.js';
import { SubagentBridge } from '../../subagent-bridge.js';
import { parseRunSubagentParams, runSubagentParamsSchema, type RunSubagentParams } from './params.js';
import { RunSubagentRulesSchema, parseRunSubagentRules, type RunSubagentRules } from './rules.js';

const POLL_INTERVAL_MS = 150;

/**
 * Run a task in a subagent: a REAL child conversation driven through the normal
 * message pipeline — planner loop, tools, approvals, SSE — visible and
 * inspectable in the sidebar like any other chat. The parent tool call waits
 * for the child run to settle and returns its final answer.
 *
 * Contrast with the other delegation tools: `delegate_to_llm` is one LLM call
 * with no tools; `switch_llm` re-engines THIS context. A subagent has a fresh,
 * separate context and full agency within its agent's tool policies — use it
 * when a sub-task is big or noisy enough that context isolation pays for
 * writing a self-contained brief.
 *
 * Recursion is bounded by the subagent_depth column: children record their
 * parent + depth, and max_depth (default 1) stops chains fail-closed.
 * A tool awaiting user approval inside the child does not end the wait — the
 * user can approve it in the child conversation; only settle or timeout ends it.
 */
@Injectable()
export class RunSubagentTool extends BaseTool<RunSubagentParams, RunSubagentRules> {
  constructor(
    private readonly bridge: SubagentBridge,
    private readonly conversations: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly agents: AgentsRepo,
  ) {
    super();
  }

  getName(): string {
    return 'run_subagent';
  }

  getAiDescription(): string {
    return (
      'Delegate a sub-task to a subagent running in its own fresh conversation (full agent loop with tools), ' +
      'and get its final answer back. The subagent knows NOTHING about this conversation — write a ' +
      'self-contained brief. Use for sub-tasks worth isolating; for a quick second opinion use delegate_to_llm.'
    );
  }

  getHumanDescription(): string {
    return 'Spawn a subagent in its own conversation and return its final answer.';
  }

  getParamsSchema(): unknown {
    return runSubagentParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(RunSubagentRulesSchema);
  }

  getDefaultRules(): RunSubagentRules {
    return parseRunSubagentRules({});
  }

  parseParams(raw: unknown): RunSubagentParams {
    return parseRunSubagentParams(raw);
  }

  parseRules(raw: unknown): RunSubagentRules {
    return parseRunSubagentRules(raw);
  }

  async runTool(params: RunSubagentParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseRunSubagentRules(context.toolRules ?? this.getDefaultRules());
    context.signal.throwIfAborted();

    // Depth guard — fail-closed recursion bound, derived from the DB.
    const { depth } = await this.conversations.getSubagentLink(context.conversationId);
    const childDepth = depth + 1;
    if (childDepth > rules.max_depth) {
      throw new Error(
        `run_subagent: max_depth ${rules.max_depth} reached — this conversation is already at subagent depth ${depth}`,
      );
    }

    const agentId = params.agent_id ?? context.agentId;
    if (!agentId) throw new Error('run_subagent: no agent to run the subagent as');
    if (params.agent_id && params.agent_id !== context.agentId && !rules.allow_other_agents) {
      throw new Error('run_subagent: spawning as a different agent requires allow_other_agents=true in tool rules');
    }
    const agent = await this.agents.get(agentId);
    if (!agent) throw new Error(`run_subagent: unknown agent '${agentId}'`);

    const processor = this.bridge.get();
    // The child inherits the parent's sandbox so target tools keep working on
    // the same workspace.
    const toolSandboxId = await this.conversations.getToolSandboxId(context.conversationId);
    const child = await this.conversations.create({
      title: params.title ?? 'Subagent task',
      ...(toolSandboxId ? { toolSandboxId } : {}),
    });
    await this.conversations.setSubagentLink(child.id, context.conversationId, childDepth);
    context.log?.(`subagent conversation ${child.id} started (agent "${agent.name}", depth ${childDepth})`);

    const startedAt = Date.now();
    const deadline = startedAt + rules.timeout_ms;
    try {
      await processor.processMessage(child.id, { message: params.prompt, agentId });
      let approvalNoted = false;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        context.signal.throwIfAborted();
        if (Date.now() >= deadline) {
          throw new Error(
            `run_subagent: timed out after ${rules.timeout_ms}ms — cancelled; inspect conversation ${child.id}`,
          );
        }
        if (processor.isProcessing(child.id)) continue;
        // Idle scope ≠ settled: a tool awaiting user approval parks the run
        // with no active scope. Keep waiting so the user can approve it in the
        // child conversation.
        const entries = await this.chatEntries.listChatEntries(child.id);
        if (entries.some((e) => e.type === 'tool-invocation' && e.state === 'requested')) {
          if (!approvalNoted) {
            approvalNoted = true;
            context.log?.(`subagent is waiting for user approval in conversation ${child.id}`);
          }
          continue;
        }
        return this.collectResult(child.id, agentId, entries, rules, Date.now() - startedAt);
      }
    } catch (err) {
      processor.cancelProcessing(child.id);
      throw err;
    }
  }

  private collectResult(
    conversationId: string,
    agentId: string,
    entries: ChatEntry[],
    rules: RunSubagentRules,
    elapsedMs: number,
  ): unknown {
    const lastAssistant = [...entries].reverse().find((e) => e.type === 'assistant-message');
    if (!lastAssistant || lastAssistant.type !== 'assistant-message' || !lastAssistant.text.trim()) {
      throw new Error(`run_subagent: subagent produced no answer — inspect conversation ${conversationId}`);
    }
    const fullAnswer = lastAssistant.text.trim();
    const answer =
      fullAnswer.length > rules.max_response_chars ? fullAnswer.slice(0, rules.max_response_chars) : fullAnswer;
    const plannerRounds = entries.filter(
      (e) => e.type === 'thought' && e.thoughtType === 'planner' && !e.isSide,
    ).length;
    const toolCalls = entries.filter((e) => e.type === 'tool-invocation').length;
    return {
      conversation_id: conversationId,
      agent_id: agentId,
      answer,
      answer_chars: answer.length,
      planner_rounds: plannerRounds,
      tool_calls: toolCalls,
      elapsed_ms: elapsedMs,
    };
  }
}
