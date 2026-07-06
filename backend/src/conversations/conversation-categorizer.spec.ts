import {
  canonicalizeCategory,
  CategorizeThoughtTypeProvider,
  parseCategory,
  type CategorizeInput,
} from '../thoughtProcessing/thoughtTypeProviders/categorizeProvider.js';
import { normalizeConversationCategorizationConfig } from '../contracts/conversation-config.js';
import { ConversationCategorizerService } from './conversation-categorizer.service.js';
import { getMessageText } from '../llmProviders/types.js';

describe('parseCategory', () => {
  it('returns a clean single-word category', () => {
    expect(parseCategory('Coding')).toBe('Coding');
  });

  it('strips surrounding quotes and whitespace', () => {
    expect(parseCategory('  "Personal Finance"  ')).toBe('Personal Finance');
  });

  it('drops a leading think block and keeps the first real line', () => {
    expect(parseCategory('<think>let me decide</think>\nWork\nbecause it is work')).toBe('Work');
  });

  it('strips a "Category:" prefix', () => {
    expect(parseCategory('Category: Research')).toBe('Research');
  });

  it('strips trailing punctuation', () => {
    expect(parseCategory('Admin.')).toBe('Admin');
  });

  it('returns null for empty / non-alphanumeric output', () => {
    expect(parseCategory('')).toBeNull();
    expect(parseCategory('   ')).toBeNull();
    expect(parseCategory('---')).toBeNull();
  });

  it('caps very long output', () => {
    const long = 'x'.repeat(120);
    expect(parseCategory(long)!.length).toBe(40);
  });
});

describe('canonicalizeCategory', () => {
  it('maps onto an existing category case-insensitively', () => {
    expect(canonicalizeCategory('coding', ['Work', 'Coding'])).toBe('Coding');
  });

  it('keeps a genuinely new category', () => {
    expect(canonicalizeCategory('DevOps', ['Work', 'Coding'])).toBe('DevOps');
  });
});

describe('CategorizeThoughtTypeProvider.runPrepare', () => {
  // runPrepare is a pure function of its input (no `this`), so stub deps are fine.
  const provider = new CategorizeThoughtTypeProvider({} as any, {} as any, {} as any, {} as any);
  const baseInput: CategorizeInput = {
    conversationId: 'c1',
    title: 'New chat',
    firstUserText: 'How do I center a div?',
    existingGroups: ['Work', 'Coding', 'Personal Finance'],
    prompt: 'Classify the conversation.',
  };

  it('lists every existing group in the system prompt', () => {
    const request = provider.runPrepare(baseInput);
    expect(request.messages[0].role).toBe('system');
    const system = getMessageText(request.messages[0]);
    for (const group of baseInput.existingGroups) {
      expect(system).toContain(group);
    }
  });

  it('does not prefill a <think></think> assistant turn', () => {
    const request = provider.runPrepare(baseInput);
    expect(request.messages.every((m) => m.role !== 'assistant')).toBe(true);
    expect(JSON.stringify(request)).not.toContain('<think>');
  });
});

describe('normalizeConversationCategorizationConfig', () => {
  it('fills defaults from an empty/invalid blob', () => {
    const cfg = normalizeConversationCategorizationConfig(null);
    expect(cfg.enabled).toBe(true);
    expect(cfg.sidebarRecentLimit).toBe(25);
    expect(cfg.prompt.length).toBeGreaterThan(0);
  });

  it('clamps the sidebar limit and merges partial values', () => {
    const cfg = normalizeConversationCategorizationConfig({ enabled: false, sidebarRecentLimit: 9999 });
    expect(cfg.enabled).toBe(false);
    expect(cfg.sidebarRecentLimit).toBe(200);
  });
});

describe('ConversationCategorizerService.shouldCategorize', () => {
  // Stub the three repos shouldCategorize touches; getConfig reads getJson then normalizes.
  const make = (over: {
    enabled?: boolean;
    pinned?: boolean;
    groups?: Array<{ name: string }>;
    messages?: Array<{ type: string; text?: string }>;
  } = {}): ConversationCategorizerService => {
    const {
      enabled = true,
      pinned = false,
      groups = [{ name: 'Work' }],
      messages = [{ type: 'user-message', text: 'hi' }],
    } = over;
    return new ConversationCategorizerService(
      { getJson: async () => ({ enabled }) } as any,
      { getGroupPinned: async () => pinned, listGroups: async () => groups } as any,
      { listMessages: async () => messages } as any,
    );
  };

  it('runs when enabled, unpinned, a group exists, and a first user message exists', async () => {
    expect(await make().shouldCategorize('c1')).toBe(true);
  });

  it('does NOT run when there are no existing groups', async () => {
    expect(await make({ groups: [] }).shouldCategorize('c1')).toBe(false);
  });

  it('does not run when disabled', async () => {
    expect(await make({ enabled: false }).shouldCategorize('c1')).toBe(false);
  });

  it('does not run when the group is pinned', async () => {
    expect(await make({ pinned: true }).shouldCategorize('c1')).toBe(false);
  });

  it('does not run without a first user message', async () => {
    expect(await make({ messages: [] }).shouldCategorize('c1')).toBe(false);
  });
});
