import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { Runtime } from "../bootstrap/runtime.js";
import { logger } from "../infra/logger.js";
import {
  buildTypesPingResponse,
  parseSseAfterSeqHeader,
} from "./system.types.js";

export function createSystemRouter(runtime: Runtime) {
  const r = new Hono();

  r.get("/types/ping", (c) => {
    return c.json(buildTypesPingResponse());
  });

  r.get("/tools", (c) => {
    const rows = runtime.tools.list().map((tool) => ({
      name: tool.getName(),
      description: tool.getHumanDescription(),
      ai_description: tool.getAiDescription(),
      params_schema: tool.getParamsSchema(),
      rules_schema: tool.getRulesSchema(),
      default_rules: tool.getDefaultRules(),
    }));
    return c.json(rows);
  });

  r.get("/stream", async (c) => {
    const afterSeqFromQuery = parseSseAfterSeqHeader(c.req.query("after_seq"));
    const afterSeqFromHeader = parseSseAfterSeqHeader(c.req.header("Last-Event-ID"));
    const afterSeq = afterSeqFromQuery ?? afterSeqFromHeader;

    logger.info({ afterSeq }, "[sse] global stream subscribed");
    return streamSSE(c, async (stream) => {
      let aborted = false;
      let unsubscribe = () => {};
      let ka: ReturnType<typeof setInterval> | null = null;

      stream.onAbort(() => {
        aborted = true;
        unsubscribe();
        if (ka) clearInterval(ka);
        logger.info("[sse] global stream aborted");
      });

      unsubscribe = runtime.hub.subscribe(
        (ev) => {
          if (aborted) return;
          void stream.writeSSE(
            {
              id: String(ev.seq),
              data: JSON.stringify(ev),
            },
          );
        },
        {
          replay: true,
          afterSeq,
        },
      );

      ka = setInterval(() => {
        if (aborted) return;
        void stream.writeSSE({ event: "ka", data: "{}" });
      }, 15000);

      while (!aborted) {
        await stream.sleep(1000);
      }
    });
  });

  return r;
}
