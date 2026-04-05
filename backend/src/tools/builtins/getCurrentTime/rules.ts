import { z } from "zod";

export type GetCurrentTimeToolRules = {
  allowed: "always" | "never" | "ask";
};

export function getCurrentTimeRulesSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      allowed: {
        type: "string",
        enum: ["always", "never", "ask"],
        description: "Single permission rule for this tool.",
      },
    },
    required: ["allowed"],
  };
}

export function parseGetCurrentTimeToolRules(raw: unknown): GetCurrentTimeToolRules {
  const parsed = z
    .object({
      allowed: z.enum(["always", "never", "ask"]).default("always"),
    })
    .strict()
    .parse(raw);
  return { allowed: parsed.allowed };
}
