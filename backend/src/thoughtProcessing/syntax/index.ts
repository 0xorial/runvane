/**
 * Extensible, decoupled multi-syntax matching engine.
 *
 * Register {@link SyntaxProvider}s with a {@link SyntaxRegistry}, then either
 * `registry.parse(text)` for one-shot parsing or `registry.createSelector()` to
 * drive a streaming {@link SyntaxSelector} that locks onto one syntax. The
 * engine is generic over the parsed output `T` and knows nothing about any
 * concrete format.
 */
export { MatchKind } from './types.js';
export type {
  MatchResult,
  ObserveOptions,
  SelectorConfig,
  SyntaxParser,
  SyntaxProvider,
} from './types.js';
export { match, incomplete, NO_MATCH, INCOMPLETE } from './match.js';
export { defineSyntax } from './define.js';
export type { DefinedSyntax, Sniff, SyntaxSpec } from './define.js';
export { SyntaxSelector } from './selector.js';
export { SyntaxRegistry } from './registry.js';
