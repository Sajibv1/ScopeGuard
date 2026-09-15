/**
 * Text recognition for screenshots of client messages (plan: request capture).
 *
 * The scope-side OCR module (lib/pdf/ocr.ts) recognises scanned agreements
 * and faces the hardest version of the trust problem: its output can become
 * a baseline. This module faces a lighter one, but not a trivial one. A
 * screenshot of a chat becomes the client message, and the client message is
 * what assessments quote as the client's own words. A recognition error
 * ("two revisions" read as "ten revisions") would be quoted as though the
 * client wrote it.
 *
 * So the same rule applies in a lighter form: recognised text is handed to
 * the user for review in the message box itself — they read it, fix it, and
 * only then submit. The review surface is the same textarea the analysis
 * quotes from, which is the whole safeguard. Nothing is recognised silently
 * into the pipeline.
 */

import "server-only";

import { createWorker, type Worker } from "tesseract.js";

import { isGarbled } from "../pdf/extract.ts";
import { CLIENT_MESSAGE_LIMIT } from "../limits.ts";

export interface ScreenshotOcrResult {
  text: string;
  /** Recognition confidence, 0–100, as tesseract reported it. */
  confidence: number;
  durationMs: number;
}

export class ScreenshotOcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenshotOcrError";
  }
}

/**
 * Validate recognised text before it is shown for review.
 *
 * Pure so its rules have a test, mirroring ocrTranscriptError on the scope
 * side: output too poor to read is refused rather than reviewed, and a
 * screenshot longer than the client-message limit is rejected rather than
 * trimmed — the words shown must be the words in the image.
 */
export function screenshotTextError(text: string): string | null {
  if (text.trim().length === 0) {
    return "No text could be recognised in this screenshot. If the text is small or the photo is blurry, paste the message instead.";
  }

  if (isGarbled(text)) {
    return "The text recognised from this screenshot is unreadable — it may be blurry, skewed, or low-resolution. Take a tighter screenshot of the message, or paste it instead.";
  }

  if (text.length > CLIENT_MESSAGE_LIMIT) {
    return `This screenshot contains ${text.length.toLocaleString()} characters, over the ${CLIENT_MESSAGE_LIMIT.toLocaleString()} character limit for a client message. Capture just the part containing the request.`;
  }

  return null;
}

/**
 * Recognise the text in a screenshot (PNG, JPEG, and the other formats
 * tesseract reads natively).
 */
export async function ocrScreenshot(bytes: Uint8Array): Promise<ScreenshotOcrResult> {
  const started = Date.now();

  let worker: Worker | null = null;
  try {
    worker = await createWorker("eng");
    const { data } = await worker.recognize(Buffer.from(bytes));
    const text = data.text.trim();

    return {
      text,
      confidence: Number.isFinite(data.confidence) ? data.confidence : 0,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ScreenshotOcrError(`The screenshot could not be read (${detail}).`);
  } finally {
    // A leaked worker holds a WASM heap for the life of the process.
    await worker?.terminate().catch(() => {});
  }
}
