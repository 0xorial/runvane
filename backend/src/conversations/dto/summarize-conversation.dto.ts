import { createZodDto } from 'nestjs-zod';
import { SummarizeConversationRequestSchema } from '../../contracts/conversations.js';

/**
 * Fold every entry on the active chain from `firstEntryToSummarize` through
 * the leaf (inclusive). The clicked entry IS part of the summary — it
 * disappears from the active chain after the fold and stays reachable on
 * the sibling branch via the BranchSelector. The new `checkpoint-summary`
 * entry attaches as a child of the parent of `firstEntryToSummarize`.
 */
export class SummarizeConversationDto extends createZodDto(SummarizeConversationRequestSchema) {}
