import { z } from "zod";
import { LlmRequestSchema } from "../../../backend/src/llmProviders/types";
import { AgenticPlannerOutputSchema } from "../../../backend/src/contracts/chatEntry";

/**
 * JSON Schemas fed to the Monaco editor for live validation + autocomplete.
 * Derived from the same Zod schemas the backend validates against, so the
 * editor and the runtime can't drift.
 */
export const llmRequestJsonSchema = z.toJSONSchema(LlmRequestSchema);
export const plannerOutputJsonSchema = z.toJSONSchema(AgenticPlannerOutputSchema);
