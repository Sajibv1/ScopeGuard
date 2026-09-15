import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalize, verifyQuote } from "./citations.ts";
import { fixtureTranscriptExtraction } from "./fixtures.ts";
import { buildTranscriptDocument, formatTimestamp, parseTranscript } from "../transcript/parse.ts";

/**
 * The transcript path end to end, in fixture mode: a parsed VTT becomes a
 * scope document with timestamp locators, the extraction stand-in proposes
 * items with commitment labels, and every quote VERIFIES against the built
 * document. This is the same chain a live model's output goes through — a
 * fixture citation that did not verify would be rejected exactly like a
 * hallucination.
 */
const KICKOFF = `WEBVTT

00:00:05.000 --> 00:00:12.000
Client: Yes, we'll need the site in English and German. That's agreed.

00:00:41.000 --> 00:00:49.000
Me: The design includes a contact form and an image gallery.

00:01:12.000 --> 00:01:25.000
Client: Maybe we could consider up to five product pages later.
`;

describe("transcript extraction chain", () => {
  const cues = parseTranscript(KICKOFF)!;
  const { text, locators } = buildTranscriptDocument(cues);

  /** The same offset-based labeler production uses for locator guides. */
  function labelFor(offset: number): string {
    for (const locator of locators) {
      if (offset >= locator.start && offset < locator.end) return locator.label;
    }
    return locators[0]!.label;
  }

  it("labels every item with a commitment and a timestamp locator", () => {
    const extraction = fixtureTranscriptExtraction(text, labelFor);

    assert.ok(extraction.items.length >= 2);

    const labels = extraction.items.map((item) => item.commitment);
    assert.ok(labels.includes("agreed"), `expected an agreed item, got ${labels.join(", ")}`);
    assert.ok(labels.includes("suggested"), `expected a suggested item, got ${labels.join(", ")}`);

    for (const item of extraction.items) {
      assert.match(item.locator, /^\d{2}:\d{2}:\d{2}$/);
    }
  });

  it("produces quotes that verify against the built document", () => {
    const extraction = fixtureTranscriptExtraction(text, labelFor);
    const normalized = normalize(text);

    for (const item of extraction.items) {
      const check = verifyQuote(item.quote, item.locator, {
        sourceText: text,
        locators,
        normalized,
      });
      assert.ok(
        check.ok,
        `Quote "${item.quote.slice(0, 50)}" must verify against the transcript document`,
      );
    }
  });
});

describe("transcript evidence labels", () => {
  it("timestamp labels read as clock times from the call", () => {
    const cues = parseTranscript(KICKOFF)!;
    const { locators } = buildTranscriptDocument(cues);
    assert.equal(locators[0]!.label, "00:00:05");
    assert.equal(locators[0]!.kind, "timestamp");
    assert.equal(formatTimestamp(3725), "01:02:05");
  });
});
