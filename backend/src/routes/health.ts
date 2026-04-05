import { Hono } from "hono";

import type { Runtime } from "../bootstrap/runtime.js";
import { buildHealthResponse } from "./health.types.js";

export function createHealthRouter(runtime: Runtime) {
  const r = new Hono();

  r.get("/", (c) => {
    return c.json(buildHealthResponse(runtime.queue.depth));
  });

  return r;
}
