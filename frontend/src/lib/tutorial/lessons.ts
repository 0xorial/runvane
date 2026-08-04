// The tutorial catalog: ordered lessons, each a sequence of steps over the
// REAL UI. A step names a route to be on and a `[data-tour=…]` anchor to
// spotlight; the overlay dims everything else and shows the step's text. The
// anchors are explicit attributes on the target elements — never guessed
// selectors — so a missing anchor means the UI state doesn't show that element
// (the overlay then falls back to a centered card).

export type TutorialStep = {
  /** Route the step happens on; the overlay navigates there when needed. */
  route: string;
  /** `[data-tour=…]` anchor to spotlight. Omit for a centered, page-level note. */
  anchor?: string;
  title: string;
  body: string;
};

export type TutorialLesson = {
  id: string;
  title: string;
  /** One-liner shown in the library list. */
  blurb: string;
  /** True for the guided onboarding sequence (offered in order); extras are library-only. */
  core: boolean;
  steps: TutorialStep[];
};

export const TUTORIAL_LESSONS: TutorialLesson[] = [
  {
    id: 'connect-model',
    title: 'Connect a model provider',
    blurb: 'Add an API key and verify it — models power everything else.',
    core: true,
    steps: [
      {
        route: '/settings/model-providers',
        anchor: 'providers',
        title: 'Providers',
        body:
          'Each card is an LLM provider. Paste an API key and hit Test connection — once it verifies, ' +
          'that provider’s models are selectable everywhere in Runvane. Nothing runs without at least ' +
          'one verified provider.',
      },
    ],
  },
  {
    id: 'configure-agent',
    title: 'Set up an agent',
    blurb: 'Who you talk to: model + system prompt + tool permissions.',
    core: true,
    steps: [
      {
        route: '/settings/agents',
        anchor: 'agent-picker',
        title: 'Agents',
        body:
          'An agent is who you talk to: a default model, a system prompt, and tool permissions. ' +
          'Pick one here or add a new one.',
      },
      {
        route: '/settings/agents',
        anchor: 'agent-llm',
        title: 'Default model',
        body:
          'The provider and model this agent answers with. It’s a default — you can still override ' +
          'the model per message from the composer.',
      },
      {
        route: '/settings/agents',
        anchor: 'agent-prompt',
        title: 'System prompt',
        body: 'Standing instructions prepended to every conversation this agent runs.',
      },
      {
        route: '/settings/agents',
        anchor: 'agent-tools',
        title: 'Tools & permissions',
        body:
          'What the agent may do. Per tool: Off, Ask (user approves each call), Allow, or Custom ' +
          '(the tool’s own rules decide per call). Harness tools run centrally in the backend; ' +
          'target sandbox tools run inside the conversation’s sandbox. Click a tool name to expand ' +
          'how it works — operations, parameters, safety and limits.',
      },
    ],
  },
  {
    id: 'start-chat',
    title: 'Start a chat',
    blurb: 'Pick a sandbox and an agent, then send.',
    core: true,
    steps: [
      {
        route: '/chat/new',
        anchor: 'sandbox-cards',
        title: 'Tool sandbox',
        body:
          'Where target tools execute for this conversation: the local machine, a Docker box, an SSH host — ' +
          'or none, which disables target tools. Harness tools run centrally either way.',
      },
      {
        route: '/chat/new',
        anchor: 'agent-cards',
        title: 'Agent',
        body:
          'Who answers. Each card shows the agent’s model and its enabled tools; the check marks ' +
          'your default agent.',
      },
      {
        route: '/chat/new',
        anchor: 'composer',
        title: 'Composer',
        body:
          'Type and send. The controls around the input attach files, pick context, and override ' +
          'the agent’s model for just this message.',
      },
    ],
  },
  {
    id: 'how-it-connects',
    title: 'How it all connects',
    blurb: 'Model, agent, tools, sandbox — what feeds what.',
    core: true,
    steps: [
      {
        route: '/chat/new',
        anchor: 'layout-map',
        title: 'The chain',
        body:
          'Your message goes to the agent’s model. Each round the model either answers or calls tools; ' +
          'calls run under the agent’s permissions — harness tools centrally, target tools in the sandbox ' +
          'you picked — and the results feed the next round until it answers. Model, agent, and tools are ' +
          'independent dials: the same agent can run on a different model, the same model with different tools.',
      },
    ],
  },
  {
    id: 'knowledge',
    title: 'Knowledge bases',
    blurb: 'Index folders so agents can search them.',
    core: false,
    steps: [
      {
        route: '/settings/knowledge',
        anchor: 'knowledge-section',
        title: 'Knowledge bases',
        body:
          'Index folders into searchable storages (this needs a verified provider with embedding models). ' +
          'Agents query them through the knowledge tool, and the composer can force-ground a message in a ' +
          'storage before the model ever sees it.',
      },
    ],
  },
  {
    id: 'sandboxes',
    title: 'Tool sandboxes',
    blurb: 'Define where target tools may run.',
    core: false,
    steps: [
      {
        route: '/settings/tool-sandboxes',
        anchor: 'sandboxes-section',
        title: 'Tool sandboxes',
        body:
          'The places target tools may run: local process, Docker container, or SSH host. Every conversation ' +
          'picks one when it starts; what a tool may touch there is governed by the agent’s per-tool rules.',
      },
    ],
  },
];

export function tutorialLessonById(id: string): TutorialLesson | null {
  return TUTORIAL_LESSONS.find((l) => l.id === id) ?? null;
}

/**
 * Contextual first-encounter tips: shown once, the first time their anchor
 * appears in the DOM (e.g. the first branch selector of a conversation).
 * Unlike lessons they don't dim or block anything — a small anchored callout
 * with a "Got it". Muting the tutorial mutes these too.
 */
export type TutorialTip = { id: string; anchor: string; title: string; body: string };

export const TUTORIAL_TIPS: TutorialTip[] = [
  {
    id: 'todo-panel',
    anchor: 'todo-panel',
    title: 'Agent to-dos',
    body:
      'The agent tracks its plan here (via the todo_write tool) and updates statuses as it works. ' +
      'If a long run drifts, the current list is re-surfaced to the model automatically.',
  },
  {
    id: 'branch-selector',
    anchor: 'branch-selector',
    title: 'Branches',
    body:
      'The conversation forked here — edits, retries, and summaries create sibling branches instead of ' +
      'overwriting history. Use the arrows to switch which branch you view; new messages continue the one you’re on.',
  },
  {
    id: 'tool-approval',
    anchor: 'tool-approval',
    title: 'Tool approval',
    body:
      'This call is paused until you approve or deny it — the tool’s policy is Ask, or a guardrail flagged it. ' +
      'Expand the row to inspect the arguments; you can edit them before approving.',
  },
];
