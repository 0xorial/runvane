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
  /** Uploads whose contribution only resolves at send time (images, PDFs,
   *  'summary' mode — the planner sees a summary that doesn't exist yet). */
  unknownCount: number;
};

export function estimateAttachmentTokens(
  attachments: Array<{ file: File; mode: AttachmentMode }>,
): AttachmentTokenEstimate {
  let tokens = 0;
  let unknownCount = 0;
  for (const { file, mode } of attachments) {
    const textLike = file.type.startsWith("text/") || file.type === "application/json";
    if (mode === "direct" && textLike) tokens += Math.ceil(file.size / 4);
    else unknownCount += 1;
  }
  return { tokens, unknownCount };
}
