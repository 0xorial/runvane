import { MatchKind, type MatchResult, type ObserveOptions, type SelectorConfig, type SyntaxParser, type SyntaxProvider } from './types.js';
import { NO_MATCH } from './match.js';

/**
 * Stateful, per-stream picker. Holds the `selectedSyntax` lock from the sketch:
 * feed it the latest *cumulative* message via {@link observe}; the first time a
 * provider wins it remembers that parser and every later call is a cheap no-op.
 *
 * Selection is confidence-ranked (priority breaks ties), which generalizes
 * "first match wins" — that is just the case where each provider reports
 * confidence `1` or `0`. Mid-stream it only locks on a confident match (see
 * {@link SelectorConfig.lockThreshold}); a final message commits to the best
 * available match since no more text is coming.
 *
 * Create one per message/stream — do not share across conversations.
 */
export class SyntaxSelector<T> {
  private locked: SyntaxParser<T> | null = null;
  private readonly lockThreshold: number;

  /** `providers` must already be ordered by descending priority. */
  constructor(
    private readonly providers: ReadonlyArray<SyntaxProvider<T>>,
    config: SelectorConfig = {},
  ) {
    this.lockThreshold = config.lockThreshold ?? 1;
  }

  /** The parser this selector has committed to, or `null` while undecided. */
  get selected(): SyntaxParser<T> | null {
    return this.locked;
  }

  get isLocked(): boolean {
    return this.locked !== null;
  }

  /**
   * Observe the latest cumulative `message`. Returns the locked parser once one
   * is chosen, else `null`. Idempotent and cheap once locked.
   */
  observe(message: string, options: ObserveOptions = {}): SyntaxParser<T> | null {
    if (this.locked) return this.locked;

    let best: { parser: SyntaxParser<T>; confidence: number } | null = null;
    let anyIncomplete = false;

    for (const provider of this.providers) {
      let result: MatchResult<T>;
      // A misbehaving provider must never break selection for the others.
      try {
        result = provider.tryMatch(message);
      } catch {
        result = NO_MATCH;
      }
      if (result.kind === MatchKind.Match) {
        // Strict `>` keeps the earliest (highest-priority) of equal confidences.
        if (!best || result.confidence > best.confidence) {
          best = { parser: result.parser, confidence: result.confidence };
        }
      } else if (result.kind === MatchKind.Incomplete) {
        anyIncomplete = true;
      }
    }

    if (!best) return null; // nothing matches yet
    if (options.final) {
      this.locked = best.parser; // last word — take the best we have
    } else if (best.confidence >= this.lockThreshold && !anyIncomplete) {
      // Mid-stream: only commit when certain and nothing might still upgrade.
      this.locked = best.parser;
    }
    return this.locked;
  }

  /** Forget the locked syntax so the selector can be reused for a new message. */
  reset(): void {
    this.locked = null;
  }
}
