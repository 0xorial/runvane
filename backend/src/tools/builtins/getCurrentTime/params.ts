import { z } from "zod";

export type GetCurrentTimeToolParams = Record<string, never>;

export function getCurrentTimeParamsSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
  };
}

export function parseGetCurrentTimeToolParams(raw: unknown): GetCurrentTimeToolParams {
  z.object({}).strict().parse(raw);
  return {};
}
