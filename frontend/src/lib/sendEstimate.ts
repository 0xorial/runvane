import type { AttachmentMode } from "@/api/client";

/**
 * Frontend twin of the backend's chars/4 estimator (knowledge/retrieval/
 * retrieval-context.ts `estimateContextTokens`). Keep the two in lockstep so
 * the composer's numbers line up with entry/preview numbers — always label
 * results with "~".
 */
export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export type AttachmentTokenEstimate = {
  /** ~tokens of the uploads whose prompt contribution is knowable pre-send. */
  tokens: number;
  /** Uploads whose contribution only resolves at send time ('summary' mode —
   *  the planner sees a summary that doesn't exist yet; direct binaries like
   *  PDFs, whose cost is provider/page dependent; images not yet measured). */
  unknownCount: number;
};

/** ~vision tokens for an inlined image: pixels/750 — Anthropic's rule of
 *  thumb, close enough across providers for a "~" estimate. */
function estimateImageTokens(dims: { width: number; height: number }): number {
  return Math.max(1, Math.ceil((dims.width * dims.height) / 750));
}

/**
 * Prices what direct mode actually sends (expandAttachments.ts): text-like
 * files are inlined as content (bytes/4), images become vision parts (priced
 * from their measured dimensions), other binaries become base64 file parts
 * whose real cost is provider-dependent → unknown. Summary mode is always
 * unknown pre-send.
 */
export function estimateAttachmentTokens(
  attachments: Array<{ file: File; mode: AttachmentMode; imageDims?: { width: number; height: number } }>,
): AttachmentTokenEstimate {
  let tokens = 0;
  let unknownCount = 0;
  for (const { file, mode, imageDims } of attachments) {
    if (mode !== "direct") {
      unknownCount += 1;
      continue;
    }
    if (file.type.startsWith("image/")) {
      if (imageDims) tokens += estimateImageTokens(imageDims);
      else unknownCount += 1;
      continue;
    }
    const textLike = file.type.startsWith("text/") || file.type === "application/json";
    if (textLike) tokens += Math.ceil(file.size / 4);
    else unknownCount += 1;
  }
  return { tokens, unknownCount };
}
