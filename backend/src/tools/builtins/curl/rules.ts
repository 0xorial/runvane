import { z } from "zod";

export type CurlToolRules = {
  allowed: "always" | "never" | "ask";
  allowHttp: boolean;
  allowedHosts: string[];
  blockedHosts: string[];
  maxTimeoutMs: number;
  maxResponseBytes: number;
};
const HostListSchema = z.array(z.string().min(1));
const CurlToolRulesSchema = z
  .object({
    allowed: z.enum(["always", "never", "ask"]).default("ask"),
    allowHttp: z.boolean().default(false),
    allowedHosts: HostListSchema.default([]),
    blockedHosts: HostListSchema.default([
      "localhost",
      "127.0.0.1",
      "::1",
      "0.0.0.0",
      "169.254.169.254",
    ]),
    maxTimeoutMs: z.number().finite().int().min(100).max(60000).default(10000),
    maxResponseBytes: z.number().finite().int().min(256).max(1000000).default(50000),
  })
  .strict();

export function curlRulesSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      allowed: {
        type: "string",
        enum: ["always", "never", "ask"],
        default: "ask",
        description: "Permission behavior for this tool.",
      },
      allowHttp: {
        type: "boolean",
        default: false,
        description: "Allow plain HTTP (otherwise HTTPS only).",
      },
      allowedHosts: {
        type: "array",
        items: { type: "string" },
        default: [],
        description:
          "Optional allowlist. Empty means no allowlist check. Supports exact host or *.example.com.",
      },
      blockedHosts: {
        type: "array",
        items: { type: "string" },
        default: ["localhost", "127.0.0.1", "::1", "0.0.0.0", "169.254.169.254"],
        description: "Blocklist of hosts. Supports exact host or *.example.com.",
      },
      maxTimeoutMs: {
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
    },
    required: ["allowed"],
  };
}

export function parseCurlToolRules(raw: unknown): CurlToolRules {
  const parsed = CurlToolRulesSchema.parse(raw);
  return {
    allowed: parsed.allowed,
    allowHttp: parsed.allowHttp,
    allowedHosts: parsed.allowedHosts.map((h) => h.toLowerCase()),
    blockedHosts: parsed.blockedHosts.map((h) => h.toLowerCase()),
    maxTimeoutMs: parsed.maxTimeoutMs,
    maxResponseBytes: parsed.maxResponseBytes,
  };
}
