import { z } from "zod";

export const ToolPermissionSchema = z.enum(["allow", "ask_user", "forbid"]);

export const AgentToolConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    policy: ToolPermissionSchema.optional(),
    rules: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const AgentDefaultLlmConfigurationSchema = z
  .object({
    provider_id: z.string().optional(),
    model_name: z.string().optional(),
    tools: z.record(z.string(), AgentToolConfigSchema).optional(),
  })
  .strict();

export type AgentDefaultLlmConfiguration = z.infer<typeof AgentDefaultLlmConfigurationSchema>;

function formatConfigError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
  return new Error(`${context} invalid default_llm_configuration: ${details}`);
}

export function parseAgentDefaultLlmConfigurationStrict(
  value: unknown,
  context: string,
): AgentDefaultLlmConfiguration | null {
  if (value == null) return null;
  const parsed = AgentDefaultLlmConfigurationSchema.safeParse(value);
  if (!parsed.success) throw formatConfigError(context, parsed.error);
  return parsed.data;
}
