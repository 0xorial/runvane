export type BuildToolParamsPromptInput = {
  toolName: string;
  toolAiDescription: string;
  toolParamsSchema: unknown;
  toolRequest: string;
};

export function buildToolParamsPrompt(input: BuildToolParamsPromptInput): string {
  return `You produce ONLY JSON object parameters for one tool.

Tool name: ${input.toolName}
Tool AI description: ${input.toolAiDescription}
Tool parameter JSON schema:
${JSON.stringify(input.toolParamsSchema, null, 2)}

Tool request:
${input.toolRequest}

Return ONLY valid JSON object for tool parameters.`;
}

export function parseToolParamsJson(text: string, context: string): Record<string, unknown> {
  const stripped = String(text ?? '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(stripped);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${context}: expected JSON object`);
  }
  return parsed as Record<string, unknown>;
}
