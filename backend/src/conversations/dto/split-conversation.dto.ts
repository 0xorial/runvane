import { createZodDto } from 'nestjs-zod';
import { SplitConversationRequestSchema } from '../../contracts/conversations.js';

/**
 * Split the subtree rooted at `entryId` out of the conversation into a new one.
 * The clicked entry becomes the root of the new conversation; it and every
 * descendant move there, and the new conversation links back to this one.
 */
export class SplitConversationDto extends createZodDto(SplitConversationRequestSchema) {}
