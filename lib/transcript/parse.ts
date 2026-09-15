/**
 * Transcript parsing (plan §10, Tier 1).
 *
 * A call transcript is a legitimate scope source, but it is not a contract.
 * The parser's job is to turn a Zoom/Meet/Whisper transcript into the same
 * shape every other source document has — text plus addressable locators —
 * so quote verification, evidence highlighting, and human confirmation work
 * unchanged. The differences stop at the edges:
 *
 *  - Timestamps are stripped from the stored text (they would pollute quotes)
 *    but become the locator labels, so evidence reads "at 00:32:15".
 *  - The document is a transcription of a conversation. Whether the machine
 *    that produced it was Zoom's, Whisper's, or a human stenographer's, the
 *    review gate applies before it can become a baseline (see 0009).
 */

import type { Locator } from "../types.ts";

/** One timed stretch of speech. Times are seconds from the start of the call. */
export interface TranscriptCue {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Locators group cues into windows of this many seconds, anchored at the
 * first cue. A one-hour call therefore produces ~60 locators — enough
 * resolution for evidence, few enough that the locator guide stays a guide.
 */
export const TRANSCRIPT_WINDOW_SEC = 60;

/** Longest call we accept. Over-length input is rejected, never truncated. */
export const TRANSCRIPT_MAX_DURATION_SEC = 2 * 60 * 60;

/** WebVTT and SRT timing lines. Hours are optional in WebVTT. */
const TIMING_LINE =
  /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

/** Inline markup WebVTT embeds in cue text: <c>, <v Speaker>, <00:00:05.000>. */
const INLINE_TAG = /<\/?[^>]+>/g;

function seconds(h: string | undefined, m: string, s: string, ms: string): number {
  return (Number(h ?? 0) * 60 + Number(m)) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

/**
 * Parse pasted WebVTT or SRT content into cues.
 *
 * Returns null when the text contains no timing lines — the caller must not
 * guess; it offers the paste tab instead, where text without timestamps is
 * legitimate. Cue numbers, NOTE/STYLE/REGION blocks, and inline tags are
 * dropped; speaker labels are KEPT, because who said a thing is exactly what
 * a scope commitment turns on.
 */
export function parseTranscript(input: string): TranscriptCue[] | null {
  const lines = input.replace(/^﻿/, "").split(/\r?\n/);
  const cues: TranscriptCue[] = [];

  let current: TranscriptCue | null = null;

  const flush = () => {
    if (current && current.text.trim().length > 0) {
      current.text = current.text.trim();
      cues.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const timing = TIMING_LINE.exec(line);
    if (timing) {
      flush();
      current = {
        startSec: seconds(timing[1], timing[2]!, timing[3]!, timing[4]!),
        endSec: seconds(timing[5], timing[6]!, timing[7]!, timing[8]!),
        text: "",
      };
      continue;
    }

    if (current) {
      if (line.trim().length === 0) {
        flush();
      } else {
        current.text += (current.text ? "\n" : "") + line.replace(INLINE_TAG, "").trim();
      }
    }
  }
  flush();

  return cues.length > 0 ? cues : null;
}

/** 754 seconds → "00:12:34". Always h:mm:ss so labels sort and read alike. */
export function formatTimestamp(totalSec: number): string {
  const whole = Math.floor(totalSec);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Build the scope document from reviewed cues: the stored text is the cue
 * texts joined with newlines, and locators are timestamp windows over that
 * text. Offsets are into the joined text, so quote verification and source
 * highlighting work exactly as they do for pasted text and PDFs.
 *
 * Callers must pass cues the user has already reviewed on screen — this
 * function is pure, so the review gate is enforced by the action that calls
 * it, which is also what sets transcript_reviewed_at.
 */
export function buildTranscriptDocument(cues: TranscriptCue[]): {
  text: string;
  locators: Locator[];
} {
  if (cues.length === 0) {
    throw new Error("The transcript is empty. Nothing was said, or nothing was captured.");
  }

  const locators: Locator[] = [];
  const parts: string[] = [];
  let offset = 0;
  // The current window opens at windowFrom and its text starts at windowStartOffset.
  let windowFrom = 0;
  let windowStartSec = cues[0]!.startSec;
  let windowStartOffset = 0;
  let index = 0;

  cues.forEach((cue, i) => {
    const start = offset;
    parts.push(cue.text);
    offset += cue.text.length;

    if (i < cues.length - 1) {
      parts.push("\n");
      offset += 1;
    }

    const last = i === cues.length - 1;

    // A cue that starts a new minute closes the current window just before
    // itself — it belongs to the next one. A window never closes empty; a
    // long gap between cues just advances the window instead. The final cue
    // can be the one that crosses, so the last window is pushed after.
    if (cue.startSec >= windowStartSec + TRANSCRIPT_WINDOW_SEC && i > windowFrom) {
      locators.push({
        id: `t${++index}`,
        kind: "timestamp",
        label: formatTimestamp(cues[windowFrom]!.startSec),
        start: windowStartOffset,
        end: start,
      });
      windowFrom = i;
      windowStartSec = cue.startSec;
      windowStartOffset = start;
    }

    if (last) {
      locators.push({
        id: `t${++index}`,
        kind: "timestamp",
        label: formatTimestamp(cues[windowFrom]!.startSec),
        start: windowStartOffset,
        end: offset,
      });
    }
  });

  return { text: parts.join(""), locators };
}

/** Total spoken duration in seconds, from the first cue to the last cue's end. */
export function transcriptDurationSec(cues: TranscriptCue[]): number {
  const first = cues[0];
  const last = cues[cues.length - 1];
  if (!first || !last) return 0;
  return Math.max(0, last.endSec - first.startSec);
}
