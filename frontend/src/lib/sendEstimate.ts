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
   *  the planner sees a summary that doesn't exist yet; media not yet
   *  measured; binaries no rule knows how to price). */
  unknownCount: number;
};

/**
 * Vision/document costing differs per model family, and the composer knows
 * the send's model — so the estimate uses that family's own rules rather
 * than one generic formula. Detected from the model NAME (runvane routes
 * many vendors through one provider, e.g. OpenRouter).
 */
type ModelFamily = "claude" | "gpt" | "gemini" | "generic";

function detectModelFamily(modelName: string): ModelFamily {
  const name = modelName.toLowerCase();
  if (name.includes("claude")) return "claude";
  if (name.includes("gemini")) return "gemini";
  if (name.includes("gpt") || /(^|\/)o[134](-|$)/.test(name)) return "gpt";
  return "generic";
}

type Dims = { width: number; height: number };

/** ~vision tokens for one inlined image, by family:
 *  - claude: pixels/750, with the API's ~1.15Mpx downscale cap
 *  - gpt: 512px tiles after 2048→768 rescale — 85 base + 170/tile
 *  - gemini: 258 per 768px tile (flat 258 for small images)
 *  - generic: pixels/750, uncapped */
function estimateImageTokens(dims: Dims, family: ModelFamily): number {
  const { width, height } = dims;
  if (family === "claude") {
    return Math.max(1, Math.ceil(Math.min(width * height, 1_150_000) / 750));
  }
  if (family === "gpt") {
    const fitScale = Math.min(1, 2048 / Math.max(width, height));
    const shortScale = Math.min(1, 768 / Math.min(width * fitScale, height * fitScale));
    const w = width * fitScale * shortScale;
    const h = height * fitScale * shortScale;
    return 85 + 170 * (Math.ceil(w / 512) * Math.ceil(h / 512));
  }
  if (family === "gemini") {
    if (width <= 384 && height <= 384) return 258;
    return 258 * (Math.ceil(width / 768) * Math.ceil(height / 768));
  }
  return Math.max(1, Math.ceil((width * height) / 750));
}

/** ~tokens per PDF page (text + page image), rough per-family calibrations:
 *  claude documents 1,500–3,000/page → midpoint; the others are coarser. */
const PDF_TOKENS_PER_PAGE: Record<ModelFamily, number> = {
  claude: 2250,
  gpt: 1500,
  gemini: 1030,
  generic: 1500,
};

/**
 * Prices what direct mode actually sends (expandAttachments.ts): text-like
 * files are inlined as content (bytes/4), images become vision parts (priced
 * from measured dimensions by the model family's rules), PDFs are priced per
 * sniffed page. Binaries with no rule and summary mode stay at-send unknowns.
 */
export function estimateAttachmentTokens(
  attachments: Array<{
    file: File;
    mode: AttachmentMode;
    imageDims?: Dims;
    pdfPageCount?: number;
  }>,
  modelName = "",
): AttachmentTokenEstimate {
  const family = detectModelFamily(modelName);
  let tokens = 0;
  let unknownCount = 0;
  for (const { file, mode, imageDims, pdfPageCount } of attachments) {
    if (mode !== "direct") {
      unknownCount += 1;
      continue;
    }
    if (file.type.startsWith("image/")) {
      if (imageDims) tokens += estimateImageTokens(imageDims, family);
      else unknownCount += 1;
      continue;
    }
    if (file.type === "application/pdf") {
      if (pdfPageCount) tokens += pdfPageCount * PDF_TOKENS_PER_PAGE[family];
      else unknownCount += 1;
      continue;
    }
    const textLike = file.type.startsWith("text/") || file.type === "application/json";
    if (textLike) tokens += Math.ceil(file.size / 4);
    else unknownCount += 1;
  }
  return { tokens, unknownCount };
}
