/**
 * Text-based PDF extraction (plan Feature 3, P1).
 *
 * Deliberately no OCR. A scanned page is detected and explained rather than
 * silently producing an empty or garbage baseline — the plan is explicit that
 * unsupported inputs must fail with an actionable message, and that the
 * application must never silently truncate or mangle the agreement.
 *
 * Page boundaries are preserved so evidence locators read "Page 3" and the
 * citation validator can point at the right part of the document.
 */

import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import { PDF_SIZE_LIMIT, SCOPE_TEXT_LIMIT } from "../limits.ts";

export type PdfFailure =
  | "not_pdf"
  | "too_large"
  | "encrypted"
  | "no_text_layer"
  | "too_long"
  | "garbled"
  | "empty"
  | "unreadable";

export class PdfExtractionError extends Error {
  readonly kind: PdfFailure;
  /** Whether re-uploading the same file could plausibly work. */
  readonly retryable: boolean;

  constructor(kind: PdfFailure, message: string, retryable = false) {
    super(message);
    this.name = "PdfExtractionError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

export interface ExtractedPdf {
  /** One entry per page, in order. Empty pages are preserved as "". */
  pages: string[];
  pageCount: number;
  /** Pages that yielded no text — usually scans embedded in a text PDF. */
  emptyPageNumbers: number[];
}

/**
 * Pull per-page text out of a PDF buffer.
 *
 * Throws PdfExtractionError with a message written for the user, not for a
 * log. Every branch here corresponds to a row in the plan's failure-handling
 * table.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  fileName: string,
): Promise<ExtractedPdf> {
  if (bytes.byteLength === 0) {
    throw new PdfExtractionError("empty", "That file is empty. Choose another file.");
  }

  if (bytes.byteLength > PDF_SIZE_LIMIT) {
    const mb = (bytes.byteLength / 1024 / 1024).toFixed(1);
    throw new PdfExtractionError(
      "too_large",
      `${fileName} is ${mb} MB, over the ${PDF_SIZE_LIMIT / 1024 / 1024} MB limit. Upload just the section that defines the scope, or paste the text instead.`,
    );
  }

  // Check the magic bytes rather than trusting the declared MIME type.
  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  if (header !== "%PDF-") {
    throw new PdfExtractionError(
      "not_pdf",
      `${fileName} does not look like a PDF file. Upload a PDF, or paste the scope text instead.`,
    );
  }

  let pages: string[];
  let pageCount: number;

  try {
    const pdf = await getDocumentProxy(bytes);
    pageCount = pdf.numPages;

    const { text } = await extractText(pdf, { mergePages: false });
    pages = (Array.isArray(text) ? text : [text]).map((page) => page ?? "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/password|encrypt/i.test(message)) {
      throw new PdfExtractionError(
        "encrypted",
        `${fileName} is password-protected. Upload an unlocked copy, or paste the scope text instead.`,
      );
    }

    throw new PdfExtractionError(
      "unreadable",
      `${fileName} could not be read. It may be damaged. Try re-exporting it, or paste the scope text instead.`,
      true,
    );
  }

  const emptyPageNumbers = pages
    .map((page, index) => (page.trim().length === 0 ? index + 1 : 0))
    .filter((pageNumber) => pageNumber > 0);

  const combined = pages.join("\n\n").trim();

  // Every page blank means there is no text layer at all — a scan.
  if (combined.length === 0) {
    throw new PdfExtractionError(
      "no_text_layer",
      `${fileName} contains no selectable text, so it is probably a scan or an image. You can run text recognition and review the transcription, or paste the scope text instead.`,
    );
  }

  if (isGarbled(combined)) {
    throw new PdfExtractionError(
      "garbled",
      `The text extracted from ${fileName} is unreadable — this usually means the PDF uses an embedded font without proper character mapping. Copy the text out of your PDF reader and paste it instead.`,
    );
  }

  if (combined.length > SCOPE_TEXT_LIMIT) {
    throw new PdfExtractionError(
      "too_long",
      `${fileName} contains ${combined.length.toLocaleString()} characters, over the ${SCOPE_TEXT_LIMIT.toLocaleString()} character limit. Upload just the section that defines the scope — the agreement will not be shortened for you.`,
    );
  }

  return { pages, pageCount, emptyPageNumbers };
}

/**
 * Detect extraction that produced characters rather than words.
 *
 * A PDF with a broken encoding map yields runs of control characters,
 * replacement characters, or text with almost no spaces. Showing that to the
 * user as their agreement would be worse than refusing it, and the plan
 * requires garbled text to be corrected before continuing.
 */
export function isGarbled(text: string): boolean {
  const sample = text.slice(0, 4000);
  if (sample.length < 40) return false;

  // Replacement characters and control codes mean the decode failed.
  const bad = sample.match(/[\uFFFD\u0000-\u0008\u000E-\u001F]/g)?.length ?? 0;
  if (bad / sample.length > 0.02) return true;

  // Real prose is mostly letters and spaces.
  const letters = sample.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (letters / sample.length < 0.5) return true;

  // Text with no word breaks at all did not decode into words.
  const spaces = sample.match(/\s/g)?.length ?? 0;
  if (spaces / sample.length < 0.05) return true;

  return false;
}
