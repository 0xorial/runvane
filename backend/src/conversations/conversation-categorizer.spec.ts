import { canonicalizeCategory, parseCategory } from './conversation-categorizer.service.js';
import { normalizeConversationCategorizationConfig } from '../contracts/conversation-config.js';

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

describe('normalizeConversationCategorizationConfig', () => {
  it('fills defaults from an empty/invalid blob', () => {
    const cfg = normalizeConversationCategorizationConfig(null);
    expect(cfg.enabled).toBe(true);
    expect(cfg.sidebarRecentLimit).toBe(5);
    expect(cfg.seedCategories.length).toBeGreaterThan(0);
    expect(cfg.prompt.length).toBeGreaterThan(0);
  });

  it('clamps the sidebar limit and merges partial values', () => {
    const cfg = normalizeConversationCategorizationConfig({ enabled: false, sidebarRecentLimit: 9999 });
    expect(cfg.enabled).toBe(false);
    expect(cfg.sidebarRecentLimit).toBe(200);
  });

  it('drops blank seed categories', () => {
    const cfg = normalizeConversationCategorizationConfig({ seedCategories: ['Work', '', '  '] });
    expect(cfg.seedCategories).toEqual(['Work']);
  });
});
