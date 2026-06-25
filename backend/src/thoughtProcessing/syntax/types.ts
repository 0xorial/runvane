/**
 * Generic, domain-agnostic engine for detecting *which* markup syntax an
 * incoming text uses and parsing it into a canonical shape `T`.
 *
 * The motivating problem: models are unreliable about emitting a single agreed
 * format (JSON today, raw XML-ish tags the next turn, a model-specific tool-call
 * dialect after that). Instead of hard-coding "try format A, then B, then C" we
 * register a set of {@link SyntaxProvider}s and let a {@link SyntaxSelector} sniff
 * the text, pick the best match, and *lock onto it* — the same shape as:
 *
 * ```ts
 * let selectedSyntax = null;
 * function onMessage(message) {
 *   if (selectedSyntax == null)
 *     for (const p of syntaxProviders) {
 *       const m = p.tryMatch(message);
 *       if (m.success) selectedSyntax = m.syntaxParser;
 *     }
 * }
 * ```
 *
 * Nothing in this folder knows about planners, tool calls, or any concrete
 * format — that lives in the providers callers register.
 */

/** Verdict of a single provider sniffing a (possibly partial) message. */
export enum MatchKind {
  /** This syntax owns the text; commit to its parser. */
  Match = 'match',
  /** Definitely not this syntax. */
  NoMatch = 'no_match',
  /**
   * Could be this syntax, but there isn't enough text yet to be sure — e.g. an
   * opened `{` with no balancing `}`, or an unclosed tag. Lets a streaming
   * selector wait for more input instead of mis-locking on a prefix.
   */
  Incomplete = 'incomplete',
}

/**
 * Result of {@link SyntaxProvider.tryMatch}. A `Match` carries the parser to use
 * and a `confidence` in `[0, 1]` used to rank competing matches (a fully-formed,
 * unambiguous match should report `1`).
 */
export type MatchResult<T> =
  | { readonly kind: MatchKind.Match; readonly confidence: number; readonly parser: SyntaxParser<T> }
  | { readonly kind: MatchKind.NoMatch }
  | { readonly kind: MatchKind.Incomplete; readonly confidence?: number };

/** Turns a complete message in a known syntax into the canonical shape `T`. */
export interface SyntaxParser<T> {
  /** Stable identifier, e.g. `'json'`, `'gemma-tool-call'`, `'xml-tags'`. */
  readonly name: string;
  /** Parse a complete message. Must not throw — degrade gracefully instead. */
  parse(text: string): T;
}

/**
 * Detects one syntax. Providers are the unit of extensibility: register another
 * one and the selector picks it up with no changes to calling code.
 */
export interface SyntaxProvider<T> {
  /** Stable identifier, matching the parser it yields. */
  readonly name: string;
  /**
   * Higher runs first and breaks confidence ties. Use it to disambiguate
   * overlapping syntaxes (e.g. a fenced-JSON dialect ahead of bare JSON).
   * Defaults to `0`.
   */
  readonly priority?: number;
  /**
   * Cheap, allocation-light sniff over possibly-partial text. MUST be fast and
   * MUST NOT throw — it runs on every streamed chunk until a syntax is locked.
   */
  tryMatch(text: string): MatchResult<T>;
}

/** Options for {@link SyntaxSelector.observe}. */
export interface ObserveOptions {
  /**
   * Mark this as the final, complete message (stream finished / one-shot parse).
   * When final, the selector commits to the best available match even if it is
   * low-confidence, because no more text is coming to improve it.
   */
  final?: boolean;
}

/** Tuning for a {@link SyntaxSelector}. */
export interface SelectorConfig {
  /**
   * Minimum confidence required to lock a match *mid-stream* (before input is
   * final). Defaults to `1`, i.e. only lock early on a certain match; ambiguous
   * partial matches wait for more text or for the stream to end.
   */
  lockThreshold?: number;
}
