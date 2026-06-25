import { SyntaxSelector } from './selector.js';
import type { SelectorConfig, SyntaxProvider } from './types.js';

/**
 * Holds the registered {@link SyntaxProvider}s and hands out {@link SyntaxSelector}s.
 * Keeps providers sorted by descending priority (lazily) so selection order is
 * deterministic. Decoupled by construction: it never references a concrete
 * syntax — callers compose one with {@link register}.
 */
export class SyntaxRegistry<T> {
  private readonly providers: SyntaxProvider<T>[] = [];
  private sorted = true;

  constructor(private readonly config: SelectorConfig = {}) {}

  /** Add one or more providers. Chainable. */
  register(...providers: SyntaxProvider<T>[]): this {
    if (providers.length > 0) {
      this.providers.push(...providers);
      this.sorted = false;
    }
    return this;
  }

  /** Registered providers in selection order (descending priority). */
  list(): ReadonlyArray<SyntaxProvider<T>> {
    if (!this.sorted) {
      // Stable in V8 (Node ≥ 11): equal priorities keep registration order.
      this.providers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      this.sorted = true;
    }
    return this.providers;
  }

  /** Fresh selector over the current providers — one per message/stream. */
  createSelector(): SyntaxSelector<T> {
    return new SyntaxSelector(this.list(), this.config);
  }

  /**
   * One-shot parse of a complete message: select the winning syntax and run its
   * parser. Returns `null` only if no provider matched at all (register a
   * catch-all fallback provider to guarantee a result).
   */
  parse(text: string): T | null {
    const parser = this.createSelector().observe(text, { final: true });
    return parser ? parser.parse(text) : null;
  }
}
