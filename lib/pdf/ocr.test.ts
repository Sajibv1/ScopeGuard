import assert from "node:assert/strict";
import { test } from "node:test";

import {
  lowConfidencePageNumbers,
  ocrTranscriptError,
  weightedConfidence,
  type OcrPage,
} from "./ocr.ts";
import { OCR_MIN_CONFIDENCE, SCOPE_TEXT_LIMIT } from "../limits.ts";

function page(overrides: Partial<OcrPage>): OcrPage {
  return { page: 1, text: "text", confidence: 90, characters: 4, ...overrides };
}

test("weightedConfidence weights by characters recognised, not pages", () => {
  // A 10-character page at 30% must not drag down a 2000-character page at 95%.
  const result = weightedConfidence([
    page({ page: 1, text: "ab", confidence: 30, characters: 2 }),
    page({ page: 2, text: "x".repeat(2000), confidence: 95, characters: 2000 }),
  ]);

  assert.ok(result > 94, `expected ~94.95, got ${result}`);
  assert.ok(result < 95);
});

test("weightedConfidence returns 0 for a fully empty transcript", () => {
  assert.equal(weightedConfidence([]), 0);
  assert.equal(weightedConfidence([page({ text: "", characters: 0 })]), 0);
});

test("lowConfidencePageNumbers flags only pages with text below the threshold", () => {
  const flagged = lowConfidencePageNumbers([
    page({ page: 1, confidence: OCR_MIN_CONFIDENCE }),
    page({ page: 2, confidence: OCR_MIN_CONFIDENCE - 0.01 }),
    // An empty page has no recognised text to distrust.
    page({ page: 3, text: "", confidence: 0, characters: 0 }),
    page({ page: 4, confidence: 99 }),
  ]);

  assert.deepEqual(flagged, [2]);
});

test("ocrTranscriptError accepts a clean transcript", () => {
  const text =
    "The supplier will deliver a homepage, a contact page, and up to two revision rounds. " +
    "Content migration is excluded from this engagement. The site must load in under two seconds.";

  assert.equal(ocrTranscriptError([page({ text })]), null);
});

test("ocrTranscriptError rejects a transcript over the character limit", () => {
  const tooLong = "word ".repeat(Math.ceil(SCOPE_TEXT_LIMIT / 5) + 100);

  const error = ocrTranscriptError([page({ text: tooLong, characters: tooLong.length })]);

  assert.match(error ?? "", /over the .* character limit/);
});

test("ocrTranscriptError rejects output garbled beyond use", () => {
  // A bad scan can come back as confident noise; the same garble detector
  // that guards the text-layer path guards this one.
  const noise = "�".repeat(200);

  const error = ocrTranscriptError([page({ text: noise, characters: 200 })]);

  assert.match(error ?? "", /unreadable/i);
});
