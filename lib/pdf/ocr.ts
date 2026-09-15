/**
 * Optical character recognition for scanned scope documents.
 *
 * This module exists behind a hard product boundary, and the boundary matters
 * more than the feature.
 *
 * Everywhere else, `scope_documents.extracted_text` IS the agreement: a quote
 * verified against it is verified against what the client actually signed.
 * OCR breaks that identity. The stored text becomes a machine transcription of
 * an image, and a transcription error ("five pages" read as "hve pages") would
 * let a citation verify perfectly against words the contract never contained —
 * the citation validator cannot tell the difference, because to it the stored
 * text is ground truth.
 *
 * Two rules follow, and both are enforced outside this file:
 *
 *  1. OCR text is never a baseline until a human has reviewed it. The database
 *     refuses the row (see 0002_ocr.sql) and the action refuses the write.
 *  2. A baseline built from OCR is labelled as transcribed wherever its
 *     evidence appears, including exports.
 *
 * Recognition itself is best-effort; the honesty about it is not.
 */

import "server-only";

import { createWorker, type Worker } from "tesseract.js";
import { renderPageAsImage } from "unpdf";

import { OCR_MAX_PAGES, OCR_MIN_CONFIDENCE, SCOPE_TEXT_LIMIT } from "../limits.ts";
import { isGarbled } from "./extract.ts";

export interface OcrPage {
  page: number;
  text: string;
  confidence: number;
  characters: number;
}

export interface OcrResult {
  pages: OcrPage[];
  /** True page count of the PDF, even when recognition was capped. */
  pageCount: number;
  /** Mean confidence weighted by characters recognised. */
  confidence: number;
  /** Pages whose confidence fell below the usable threshold. */
  lowConfidencePages: number[];
  truncated: boolean;
  durationMs: number;
}

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrError";
  }
}

/**
 * Rasterise each page and recognise it.
 *
 * `bytes` is copied per page on purpose: pdf.js transfers (and thereby
 * detaches) the buffer it is handed, so reusing one across calls throws
 * DataCloneError on the second page.
 */
export async function ocrPdf(
  bytes: Uint8Array,
  options: { maxPages?: number; onProgress?: (page: number, total: number) => void } = {},
): Promise<OcrResult> {
  const started = Date.now();
  const limit = options.maxPages ?? OCR_MAX_PAGES;

  const { getDocumentProxy } = await import("unpdf");
  const probe = await getDocumentProxy(new Uint8Array(bytes));
  const pageCount = probe.numPages;

  const target = Math.min(pageCount, limit);
  const truncated = pageCount > limit;

  let worker: Worker | null = null;
  const pages: OcrPage[] = [];

  try {
    worker = await createWorker("eng");

    for (let pageNumber = 1; pageNumber <= target; pageNumber++) {
      options.onProgress?.(pageNumber, target);

      // scale 2 roughly doubles 72dpi to ~144dpi, which is where tesseract
      // stops improving on typical contract type but cost keeps rising.
      const image = await renderPageAsImage(new Uint8Array(bytes), pageNumber, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: 2,
      });

      const { data } = await worker.recognize(Buffer.from(image));
      const text = data.text.trim();

      pages.push({
        page: pageNumber,
        text,
        confidence: Number.isFinite(data.confidence) ? data.confidence : 0,
        characters: text.length,
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new OcrError(`The scanned pages could not be read (${detail}).`);
  } finally {
    // A leaked worker holds a WASM heap for the life of the process.
    await worker?.terminate().catch(() => {});
  }

  const recognised = pages.filter((page) => page.characters > 0);

  if (recognised.length === 0) {
    throw new OcrError(
      "No text could be recognised in this document. If the scan is faint, skewed, or handwritten, retype the scope section instead.",
    );
  }

  return {
    pages,
    pageCount,
    confidence: weightedConfidence(recognised),
    lowConfidencePages: lowConfidencePageNumbers(pages),
    truncated,
    durationMs: Date.now() - started,
  };
}

/**
 * Pages whose recognition confidence fell below the usable threshold.
 *
 * Pure and exported so the triage rule has a test next to weightedConfidence.
 */
export function lowConfidencePageNumbers(pages: OcrPage[]): number[] {
  return pages
    .filter((page) => page.characters > 0 && page.confidence < OCR_MIN_CONFIDENCE)
    .map((page) => page.page);
}

/**
 * Validate the combined transcript before it is shown for review.
 *
 * The same failure table the text-layer path uses, applied to OCR output: a
 * scan of a whole contract is over the limit, and a scan too poor to read
 * produces garbled output that must be refused rather than reviewed.
 */
export function ocrTranscriptError(pages: OcrPage[]): string | null {
  const combined = pages.map((page) => page.text).join("\n\n");

  if (isGarbled(combined)) {
    return "The text recognised from this scan is unreadable — the scan may be too faint, skewed, or low-resolution. Upload a clearer scan, or paste the scope text instead.";
  }

  if (combined.length > SCOPE_TEXT_LIMIT) {
    return `This scan contains ${combined.length.toLocaleString()} characters, over the ${SCOPE_TEXT_LIMIT.toLocaleString()} character limit. Upload just the section that defines the scope — the agreement will not be shortened for you.`;
  }

  return null;
}

/**
 * Weight by characters recognised, not a flat mean.
 *
 * A near-empty page that OCRs at 30% would drag down an otherwise clean
 * document, and a flat average would understate a good scan badly enough to
 * make the number useless for deciding whether to trust the transcription.
 */
export function weightedConfidence(pages: OcrPage[]): number {
  const totalCharacters = pages.reduce((sum, page) => sum + page.characters, 0);
  if (totalCharacters === 0) return 0;

  const weighted = pages.reduce(
    (sum, page) => sum + page.confidence * page.characters,
    0,
  );

  return Math.round((weighted / totalCharacters) * 100) / 100;
}
