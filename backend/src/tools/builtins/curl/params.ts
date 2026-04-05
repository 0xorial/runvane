import { z } from "zod";

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type CurlMethod = (typeof ALLOWED_METHODS)[number];
const CurlToolParamsSchema = z
  .object({
    url: z.string().min(1),
    method: z.enum(ALLOWED_METHODS).default("GET"),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().optional(),
    timeoutMs: z.number().finite().int().min(100).max(60000).default(10000),
    maxResponseBytes: z.number().finite().int().min(256).max(1000000).default(50000),
    followRedirects: z.boolean().default(true),
  })
  .strict();

export type CurlToolParams = {
  url: string;
  method: CurlMethod;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  followRedirects: boolean;
};

export function curlParamsSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        description: "Absolute URL to request (http/https).",
      },
      method: {
        type: "string",
        enum: [...ALLOWED_METHODS],
        default: "GET",
      },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        default: {},
      },
      body: {
        type: "string",
        description: "Optional request body for POST/PUT/PATCH/DELETE.",
      },
      timeoutMs: {
        type: "integer",
        minimum: 100,
        maximum: 60000,
        default: 10000,
      },
      maxResponseBytes: {
        type: "integer",
        minimum: 256,
        maximum: 1000000,
        default: 50000,
      },
      followRedirects: {
        type: "boolean",
        default: true,
      },
    },
    required: ["url"],
  };
}

export function parseCurlToolParams(raw: unknown): CurlToolParams {
  const parsed = CurlToolParamsSchema.parse(raw);
  return {
    url: parsed.url,
    method: parsed.method as CurlMethod,
    headers: parsed.headers,
    ...(typeof parsed.body === "string" ? { body: parsed.body } : {}),
    timeoutMs: parsed.timeoutMs,
    maxResponseBytes: parsed.maxResponseBytes,
    followRedirects: parsed.followRedirects,
  };
}
