import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTranscriptDocument,
  formatTimestamp,
  parseTranscript,
  transcriptDurationSec,
  TRANSCRIPT_MAX_DURATION_SEC,
} from "./parse.ts";

const VTT = `WEBVTT

1
00:00:05.000 --> 00:00:09.000
Client: We'll need the site in English and German.

2
00:00:41.000 --> 00:00:45.000
Me: That's included in the quoted work.

3
00:01:12.000 --> 00:01:20.000
Client: Maybe we could add a blog later, not sure yet.
`;

describe("parseTranscript", () => {
  it("parses WebVTT cues with timestamps stripped and speaker labels kept", () => {
    const cues = parseTranscript(VTT);
    assert.ok(cues);
    assert.equal(cues.length, 3);
    assert.equal(cues[0]!.startSec, 5);
    assert.equal(cues[0]!.text, "Client: We'll need the site in English and German.");
    assert.equal(cues[2]!.startSec, 72);
  });

  it("parses SRT timing with comma decimals", () => {
    const srt = `1
00:00:01,500 --> 00:00:03,000
Hello there

2
00:00:04,000 --> 00:00:06,250
And again
`;
    const cues = parseTranscript(srt);
    assert.ok(cues);
    assert.equal(cues[0]!.startSec, 1.5);
    assert.equal(cues[1]!.endSec, 6.25);
  });

  it("parses WebVTT minute:second timings without hours", () => {
    const vtt = `WEBVTT

00:05.000 --> 00:09.000
Short form cue
`;
    const cues = parseTranscript(vtt);
    assert.ok(cues);
    assert.equal(cues[0]!.startSec, 5);
  });

  it("strips inline voice and timestamp tags from cue text", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Client>Hello <00:00:02.000>world
`;
    const cues = parseTranscript(vtt);
    assert.ok(cues);
    assert.equal(cues[0]!.text, "Hello world");
  });

  it("joins multi-line cue text with newlines", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
First line
second line
`;
    const cues = parseTranscript(vtt);
    assert.ok(cues);
    assert.equal(cues[0]!.text, "First line\nsecond line");
  });

  it("skips NOTE blocks", () => {
    const vtt = `WEBVTT

NOTE this is a comment about the file

00:00:01.000 --> 00:00:04.000
Actual cue
`;
    const cues = parseTranscript(vtt);
    assert.ok(cues);
    assert.equal(cues.length, 1);
    assert.equal(cues[0]!.text, "Actual cue");
  });

  it("returns null for text with no timing lines, rather than guessing", () => {
    assert.equal(parseTranscript("We agreed on five pages.\nNo timestamps here."), null);
    assert.equal(parseTranscript(""), null);
  });

  it("drops cues whose text is empty after cleanup", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000


00:00:05.000 --> 00:00:06.000
Kept
`;
    const cues = parseTranscript(vtt);
    assert.ok(cues);
    assert.equal(cues.length, 1);
    assert.equal(cues[0]!.text, "Kept");
  });
});

describe("formatTimestamp", () => {
  it("formats seconds as zero-padded hh:mm:ss", () => {
    assert.equal(formatTimestamp(5), "00:00:05");
    assert.equal(formatTimestamp(754), "00:12:34");
    assert.equal(formatTimestamp(3675), "01:01:15");
  });
});

describe("buildTranscriptDocument", () => {
  it("joins cue texts and labels windows by their first cue's time", () => {
    const cues = parseTranscript(VTT)!;
    const { text, locators } = buildTranscriptDocument(cues);

    assert.equal(text.split("\n").length, 3);
    assert.ok(text.includes("Client: We'll need the site in English and German."));

    // Cues at 5s and 41s share the first 60-second window; 72s opens the next.
    assert.equal(locators.length, 2);
    assert.equal(locators[0]!.kind, "timestamp");
    assert.equal(locators[0]!.label, "00:00:05");
    assert.equal(locators[1]!.label, "00:01:12");

    // Every locator's span is inside the text and windows tile it exactly.
    assert.equal(locators[0]!.start, 0);
    assert.equal(locators.at(-1)!.end, text.length);
    for (const locator of locators) {
      assert.ok(locator.start < locator.end);
      assert.ok(locator.end <= text.length);
    }
    // The boundary between windows falls between cue 2 and cue 3.
    assert.equal(text.slice(locators[0]!.start, locators[0]!.end).includes("That's included"), true);
    assert.equal(text.slice(locators[1]!.start, locators[1]!.end).includes("blog"), true);
  });

  it("keeps every cue's text addressable by some locator", () => {
    const cues = parseTranscript(VTT)!;
    const { text, locators } = buildTranscriptDocument(cues);
    for (const cue of cues) {
      assert.ok(text.includes(cue.text));
    }
    // Locators are contiguous: each starts where the previous ended.
    for (let i = 1; i < locators.length; i++) {
      assert.equal(locators[i]!.start, locators[i - 1]!.end);
    }
  });

  it("rejects an empty cue list rather than producing an empty baseline", () => {
    assert.throws(() => buildTranscriptDocument([]));
  });
});

describe("transcriptDurationSec", () => {
  it("measures first cue start to last cue end", () => {
    const cues = parseTranscript(VTT)!;
    assert.equal(transcriptDurationSec(cues), 80 - 5);
  });

  it("is zero for an empty list", () => {
    assert.equal(transcriptDurationSec([]), 0);
  });
});

describe("limits", () => {
  it("allows a two-hour call", () => {
    const cues = [
      { startSec: 0, endSec: 10, text: "Start" },
      { startSec: TRANSCRIPT_MAX_DURATION_SEC - 10, endSec: TRANSCRIPT_MAX_DURATION_SEC, text: "End" },
    ];
    assert.equal(transcriptDurationSec(cues), TRANSCRIPT_MAX_DURATION_SEC);
  });
});
