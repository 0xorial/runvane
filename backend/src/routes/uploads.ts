import { Hono } from "hono";
import { logger } from "../infra/logger.js";
import type { Runtime } from "../bootstrap/runtime.js";
import { isUploadFile, MAX_UPLOAD_BYTES, toUploadFileResponse } from "./uploads.types.js";

export function createUploadsRouter(runtime: Runtime) {
  const r = new Hono();

  r.post("/", async (c) => {
    const body = await c.req.parseBody();
    const maybeFile = body.file;
    if (!isUploadFile(maybeFile)) {
      return c.json({ detail: "multipart field `file` is required" }, 400);
    }
    if (maybeFile.size <= 0) {
      return c.json({ detail: "file is empty" }, 400);
    }
    if (maybeFile.size > MAX_UPLOAD_BYTES) {
      return c.json({ detail: "file exceeds 10MB limit" }, 400);
    }
    const bytes = await maybeFile.arrayBuffer();
    const attachment = await runtime.uploads.saveUpload({
      name: maybeFile.name,
      mimeType: maybeFile.type || "application/octet-stream",
      bytes,
    });
    logger.info({ attachmentId: attachment.id, sizeBytes: attachment.sizeBytes }, "[upload] file saved");
    const out = toUploadFileResponse(attachment);
    return c.json(out, 201);
  });

  r.get("/:uploadId/content", (c) => {
    const uploadId = c.req.param("uploadId");
    const content = runtime.uploads.readContentById(uploadId);
    if (!content) return c.json({ detail: "upload not found" }, 404);
    c.header("Content-Type", content.attachment.mimeType || "application/octet-stream");
    c.header("Content-Disposition", `inline; filename="${encodeURIComponent(content.attachment.name)}"`);
    return new Response(content.data, {
      headers: {
        "Content-Type": content.attachment.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(content.attachment.name)}"`,
      },
    });
  });

  return r;
}
