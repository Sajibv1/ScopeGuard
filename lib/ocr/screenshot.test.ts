import assert from "node:assert/strict";
import { test } from "node:test";

import { screenshotTextError } from "./screenshot.ts";
import { CLIENT_MESSAGE_LIMIT } from "../limits.ts";

test("screenshotTextError accepts a clean message", () => {
  const text =
    "Hi — could you add online ordering? Also we'd like the hero image swapped for the new team photo. Thanks!";

  assert.equal(screenshotTextError(text), null);
});

test("screenshotTextError rejects empty recognition", () => {
  assert.match(screenshotTextError("   \n  ") ?? "", /No text could be recognised/);
});

test("screenshotTextError rejects output garbled beyond use", () => {
  // The same garble detector that guards scope OCR guards this path: a bad
  // screenshot comes back as confident noise, not as a message to review.
  const noise = "�".repeat(200);

  assert.match(screenshotTextError(noise) ?? "", /unreadable/i);
});

test("screenshotTextError rejects text over the client-message limit", () => {
  const tooLong = "word ".repeat(Math.ceil(CLIENT_MESSAGE_LIMIT / 5) + 100);

  const error = screenshotTextError(tooLong);

  assert.match(error ?? "", /over the .* character limit/);
  // Over-length input is refused, never trimmed — the shown words must be
  // the words in the image.
  assert.match(error ?? "", /capture just the part/i);
});
