import { match, INCOMPLETE, NO_MATCH } from './match.js';
import { MatchKind, type SyntaxParser, type SyntaxProvider } from './types.js';

/** Verdict returned by a {@link SyntaxSpec.sniff}: a bare kind or kind + confidence. */
export type Sniff = MatchKind | { kind: MatchKind; confidence?: number };

/**
 * Declarative shape for defining a syntax in one object. {@link defineSyntax}
 * turns it into a {@link SyntaxProvider} bundled with its {@link SyntaxParser},
 * so a new dialect is a single small file.
 */
export interface SyntaxSpec<T> {
  name: string;
  priority?: number;
  /** Cheap detector over (possibly partial) text. Return `Match` to claim it. */
  sniff(text: string): Sniff;
  /** Parse a complete message known to be in this syntax. */
  parse(text: string): T;
}

/** A provider that also exposes the concrete parser it yields. */
export interface DefinedSyntax<T> extends SyntaxProvider<T> {
  readonly parser: SyntaxParser<T>;
}

/**
 * Bundle a `sniff` + `parse` pair into a provider. Removes the boilerplate of
 * wiring {@link MatchResult}s by hand:
 *
 * ```ts
 * export const jsonSyntax = defineSyntax<Out>({
 *   name: 'json',
 *   priority: 100,
 *   sniff: (t) => (looksLikeJson(t) ? { kind: MatchKind.Match, confidence: 1 } : MatchKind.NoMatch),
 *   parse: (t) => JSON.parse(t),
 * });
 * ```
 */
export function defineSyntax<T>(spec: SyntaxSpec<T>): DefinedSyntax<T> {
  const parser: SyntaxParser<T> = { name: spec.name, parse: spec.parse };
  return {
    name: spec.name,
    priority: spec.priority,
    parser,
    tryMatch(text: string) {
      const verdict = spec.sniff(text);
      const kind = typeof verdict === 'object' ? verdict.kind : verdict;
      if (kind === MatchKind.Match) {
        const confidence = typeof verdict === 'object' && verdict.confidence != null ? verdict.confidence : 1;
        return match(parser, confidence);
      }
      return kind === MatchKind.Incomplete ? INCOMPLETE : NO_MATCH;
    },
  };
}
