import { IsString, MinLength } from 'class-validator';

/**
 * Fold every entry on the active chain from `firstEntryToSummarize` through
 * the leaf (inclusive). The clicked entry IS part of the summary — it
 * disappears from the active chain after the fold and stays reachable on
 * the sibling branch via the BranchSelector. The new `checkpoint-summary`
 * entry attaches as a child of the parent of `firstEntryToSummarize`.
 */
export class SummarizeConversationDto {
  @IsString()
  @MinLength(1)
  firstEntryToSummarize!: string;
}
