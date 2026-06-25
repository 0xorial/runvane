import { MatchKind, type MatchResult, type SyntaxParser } from './types.js';

/** Shared singleton for "definitely not this syntax". */
export const NO_MATCH: MatchResult<never> = { kind: MatchKind.NoMatch };

/** Shared singleton for "maybe this syntax, but need more text". */
export const INCOMPLETE: MatchResult<never> = { kind: MatchKind.Incomplete };

/** Build a positive match for `parser` with the given confidence (default `1`). */
export function match<T>(parser: SyntaxParser<T>, confidence = 1): MatchResult<T> {
  return { kind: MatchKind.Match, confidence, parser };
}

/** `Incomplete` carrying a soft confidence hint (does not affect locking). */
export function incomplete<T>(confidence?: number): MatchResult<T> {
  return confidence == null ? INCOMPLETE : { kind: MatchKind.Incomplete, confidence };
}
