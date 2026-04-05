import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Runtime } from "./bootstrap/runtime.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createConversationsRouter } from "./routes/conversations.js";
import { createHealthRouter } from "./routes/health.js";
import { createSystemRouter } from "./routes/system.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createModelPresetsRouter } from "./routes/modelPresets.js";
import { createUploadsRouter } from "./routes/uploads.js";

function parseAllowedOrigins(): string[] {
  const raw = String(process.env.CORS_ALLOW_ORIGINS ?? "").trim();
  if (!raw) {
    return ["http://localhost:5173", "http://127.0.0.1:5173"];
  }
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function createApi(runtime: Runtime) {
  const app = new Hono();
  const allowedOrigins = parseAllowedOrigins();

  app.use(
    "/api/*",
    cors({
      origin: (origin) => {
        if (allowedOrigins.includes("*")) return "*";
        if (!origin) return allowedOrigins[0] ?? "*";
        return allowedOrigins.includes(origin) ? origin : "";
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.route("/health", createHealthRouter(runtime));
  app.route("/api", createSystemRouter(runtime));
  app.route("/api/agents", createAgentsRouter(runtime));
  app.route("/api/model-presets", createModelPresetsRouter(runtime));
  app.route("/api/settings", createSettingsRouter(runtime));
  app.route("/api/conversations", createConversationsRouter(runtime));
  app.route("/api/uploads", createUploadsRouter(runtime));

  return app;
}
