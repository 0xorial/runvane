import { defineSyntax } from './define.js';
import { match, NO_MATCH } from './match.js';
import { SyntaxRegistry } from './registry.js';
import { MatchKind, type SyntaxProvider } from './types.js';

// Toy syntaxes over `string` output — the engine is generic and format-agnostic.
const digits = defineSyntax<string>({
  name: 'digits',
  priority: 10,
  sniff: (t) => (/^\d+$/.test(t) ? MatchKind.Match : MatchKind.NoMatch),
  parse: (t) => `digits:${t}`,
});

const loud = defineSyntax<string>({
  name: 'loud',
  priority: 5,
  sniff: (t) => (t.includes('!') ? { kind: MatchKind.Match, confidence: 0.9 } : MatchKind.NoMatch),
  parse: (t) => `loud:${t}`,
});

// `<x>...</x>` — reports Incomplete while the closing tag is missing.
const tag = defineSyntax<string>({
  name: 'tag',
  priority: 20,
  sniff: (t) => {
    if (t.includes('<x>') && t.includes('</x>')) return MatchKind.Match;
    if (t.includes('<x>')) return MatchKind.Incomplete;
    return MatchKind.NoMatch;
  },
  parse: (t) => `tag:${t.slice(t.indexOf('<x>') + 3, t.indexOf('</x>'))}`,
});

const fallback = defineSyntax<string>({
  name: 'fallback',
  priority: -100,
  sniff: () => ({ kind: MatchKind.Match, confidence: 0.01 }),
  parse: (t) => `plain:${t}`,
});

const build = () => new SyntaxRegistry<string>().register(tag, digits, loud, fallback);

describe('SyntaxRegistry.parse', () => {
  it('routes a message to the matching syntax', () => {
    expect(build().parse('12345')).toBe('digits:12345');
    expect(build().parse('<x>hi</x>')).toBe('tag:hi');
  });

  it('ranks by confidence, not registration order', () => {
    // Both `loud` (0.9) and `fallback` (0.01) match; the louder one wins.
    expect(build().parse('wow!')).toBe('loud:wow!');
  });

  it('falls back to the catch-all when nothing specific matches', () => {
    expect(build().parse('just prose')).toBe('plain:just prose');
  });

  it('returns null when no provider matches and there is no fallback', () => {
    const registry = new SyntaxRegistry<string>().register(digits);
    expect(registry.parse('not a number')).toBeNull();
  });

  it('orders providers by descending priority regardless of register() order', () => {
    const lo: SyntaxProvider<string> = {
      name: 'lo',
      priority: 1,
      tryMatch: (t) => (t ? match({ name: 'lo', parse: () => 'lo' }, 0.5) : NO_MATCH),
    };
    const hi: SyntaxProvider<string> = {
      name: 'hi',
      priority: 9,
      tryMatch: (t) => (t ? match({ name: 'hi', parse: () => 'hi' }, 0.5) : NO_MATCH),
    };
    // Equal confidence → higher priority wins, even when registered last.
    expect(new SyntaxRegistry<string>().register(lo, hi).parse('x')).toBe('hi');
    expect(new SyntaxRegistry<string>().register(hi, lo).parse('x')).toBe('hi');
  });

  it('isolates a throwing provider so selection still resolves', () => {
    const boom: SyntaxProvider<string> = {
      name: 'boom',
      priority: 1000,
      tryMatch: () => {
        throw new Error('provider blew up');
      },
    };
    const registry = new SyntaxRegistry<string>().register(boom, digits, fallback);
    expect(registry.parse('42')).toBe('digits:42');
  });
});

describe('SyntaxSelector streaming lock', () => {
  it('waits on Incomplete and locks once the syntax completes', () => {
    const selector = build().createSelector();
    expect(selector.observe('<x>partial')).toBeNull(); // tag Incomplete → undecided
    expect(selector.isLocked).toBe(false);

    const locked = selector.observe('<x>partial</x>');
    expect(locked?.name).toBe('tag');
    expect(selector.isLocked).toBe(true);
  });

  it('does not lock a sub-threshold match while another provider is Incomplete', () => {
    // `<x>` makes tag Incomplete; fallback matches at 0.01 but must not win yet.
    const selector = build().createSelector();
    expect(selector.observe('<x>loading')).toBeNull();
    // Stream ends without the tag closing → commit to the best available.
    expect(selector.observe('<x>loading', { final: true })?.name).toBe('fallback');
  });

  it('locks immediately on a certain match mid-stream', () => {
    const selector = build().createSelector();
    expect(selector.observe('999')?.name).toBe('digits');
  });

  it('ignores later input once locked (the selectedSyntax lock holds)', () => {
    const selector = build().createSelector();
    expect(selector.observe('100')?.name).toBe('digits');
    // Even though this would now match `tag`, the lock is sticky.
    expect(selector.observe('100<x>y</x>')?.name).toBe('digits');
  });

  it('reset() clears the lock for reuse', () => {
    const selector = build().createSelector();
    selector.observe('5');
    expect(selector.isLocked).toBe(true);
    selector.reset();
    expect(selector.isLocked).toBe(false);
    expect(selector.observe('<x>a</x>')?.name).toBe('tag');
  });
});
