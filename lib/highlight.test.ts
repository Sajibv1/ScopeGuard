import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSegments } from "./highlight.ts";

const TEXT = "The site is English only. User accounts are excluded.";

test("returns the whole text when nothing is highlighted", () => {
  const segments = buildSegments(TEXT, []);
  assert.deepEqual(segments, [{ text: TEXT, ids: [] }]);
});

test("segments reassemble into exactly the original text", () => {
  const segments = buildSegments(TEXT, [
    { id: "a", start: 12, end: 24 },
    { id: "b", start: 26, end: 52 },
  ]);

  assert.equal(segments.map((segment) => segment.text).join(""), TEXT);
});

test("highlights the exact requested span", () => {
  const segments = buildSegments(TEXT, [{ id: "a", start: 12, end: 24 }]);
  const marked = segments.filter((segment) => segment.ids.length > 0);

  assert.equal(marked.length, 1);
  assert.equal(marked[0]!.text, "English only");
});

test("overlapping spans merge instead of nesting", () => {
  const segments = buildSegments(TEXT, [
    { id: "a", start: 0, end: 24 },
    { id: "b", start: 12, end: 30 },
  ]);

  // Text is preserved and the overlap carries both ids.
  assert.equal(segments.map((segment) => segment.text).join(""), TEXT);
  const both = segments.find((segment) => segment.ids.length === 2);
  assert.ok(both, "expected a segment covered by both highlights");
  assert.equal(both.text, "English only");
});

test("ignores malformed spans rather than corrupting the text", () => {
  const segments = buildSegments(TEXT, [
    { id: "bad", start: -5, end: -1 },
    { id: "inverted", start: 30, end: 10 },
    { id: "past-end", start: 999, end: 1200 },
  ]);

  assert.deepEqual(segments, [{ text: TEXT, ids: [] }]);
});

test("clamps a span that runs past the end of the text", () => {
  const segments = buildSegments(TEXT, [{ id: "a", start: 40, end: 9999 }]);

  assert.equal(segments.map((segment) => segment.text).join(""), TEXT);
  assert.ok(segments.some((segment) => segment.ids.includes("a")));
});
