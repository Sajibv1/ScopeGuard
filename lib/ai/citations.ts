/**
 * Citation verification.
 *
 * Plan §6 requires the backend to confirm each quotation exists in the source,
 * confirm the locator matches the passage, and reject or flag unsupported
 * citations — while normalizing "harmless extraction differences such as
 * repeated whitespace" and preserving the original passage for display.
 *
 * The approach: build a normalized copy of the source alongside an index map
 * back to original offsets. Search in normalized space (so whitespace and
 * quote-character differences don't cause false rejections), then map the
 * match span back to ORIGINAL offsets so the UI highlights and displays the
 * document's real wording, not the model's paraphrase of it.
 *
 * A model quote is never displayed as evidence unless it survives this.
 */

import type { Evidence, Locator } from "../types.ts";

export interface NormalizedText {
  /** Normalized characters, suitable for substring search. */
  text: string;
  /** map[i] = offset in the original string of normalized character i. */
  map: number[];
}

/**
 * Fold the differences that PDF extraction and copy-paste introduce, and
 * nothing else. We do NOT strip punctuation or stem words: that would let a
 * materially different quote pass as verbatim.
 */
export function normalize(input: string): NormalizedText {
  const chars: string[] = [];
  const map: number[] = [];

  let pendingSpace = false;
  let started = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    // Collapse every run of whitespace (including the newlines a PDF inserts
    // mid-sentence) into a single space.
    if (/\s/.test(ch)) {
      pendingSpace = started;
      continue;
    }

    if (pendingSpace) {
      chars.push(" ");
      map.push(i);
      pendingSpace = false;
    }

    chars.push(foldChar(ch));
    map.push(i);
    started = true;
  }

  return { text: chars.join("").toLowerCase(), map };
}

/**
 * Unify typographic variants that differ between a DOCX, a PDF and a paste.
 *
 * Must map exactly one character to exactly one character: `map` holds one
 * original offset per normalized character, so an expansion here (e.g.
 * "…" into three dots) would desync every offset after it and highlight the
 * wrong span of the source. Characters we cannot fold 1:1 are left alone —
 * both the quote and the source get identical treatment, so they still match
 * each other. Unicode spaces need no case here: they are whitespace to the
 * `\s` test above and already collapse to a single space.
 */
function foldChar(ch: string): string {
  switch (ch) {
    case "‘":
    case "’":
    case "‛":
    case "ʼ":
      return "'";
    case "“":
    case "”":
    case "‟":
      return '"';
    case "‐":
    case "‑":
    case "‒":
    case "–":
    case "—":
    case "−":
      return "-";
    default:
      return ch;
  }
}

export type CitationFailure =
  | "not_found"
  | "too_short"
  | "ambiguous_locator"
  | "locator_mismatch";

export interface CitationResult {
  ok: boolean;
  failure?: CitationFailure;
  /** The document's own wording for the matched span. */
  originalQuote?: string;
  start?: number;
  end?: number;
  locator?: string;
  detail?: string;
}

/**
 * A quote shorter than this is not evidence — "the site" appears everywhere
 * and proves nothing. Rejecting these also blocks a cheap way for a model to
 * manufacture a technically-verifiable citation.
 */
const MIN_QUOTE_CHARS = 12;

export interface VerifyOptions {
  sourceText: string;
  locators: Locator[];
  /** Pre-normalized source, if the caller is verifying many quotes. */
  normalized?: NormalizedText;
}

/**
 * Verify one model-supplied quote against the source document.
 *
 * `claimedLocator` is what the model said; we independently derive the true
 * locator from the matched offsets and compare. A model that quotes correctly
 * but cites the wrong page still gets flagged, because the plan requires the
 * locator to match the passage.
 */
export function verifyQuote(
  quote: string,
  claimedLocator: string | null,
  options: VerifyOptions,
): CitationResult {
  const normalizedSource = options.normalized ?? normalize(options.sourceText);
  const needle = normalize(quote);

  if (needle.text.replace(/\s/g, "").length < MIN_QUOTE_CHARS) {
    return {
      ok: false,
      failure: "too_short",
      detail: `Quote is too short to be evidence (minimum ${MIN_QUOTE_CHARS} characters).`,
    };
  }

  const index = normalizedSource.text.indexOf(needle.text);
  if (index === -1) {
    return {
      ok: false,
      failure: "not_found",
      detail: "Quote does not appear in the source document.",
    };
  }

  // Reject a quote that appears in several places with different locators —
  // we cannot say which passage it refers to.
  const second = normalizedSource.text.indexOf(needle.text, index + 1);

  const start = normalizedSource.map[index]!;
  const lastNormalizedIndex = index + needle.text.length - 1;
  // +1 because map holds the START offset of each normalized char, and the
  // final original character may be multi-byte-adjacent to trailing space.
  const end = normalizedSource.map[lastNormalizedIndex]! + 1;

  const trueLocator = locatorFor(start, options.locators);

  if (second !== -1) {
    const secondStart = normalizedSource.map[second]!;
    const secondLocator = locatorFor(secondStart, options.locators);
    if (secondLocator !== trueLocator) {
      return {
        ok: false,
        failure: "ambiguous_locator",
        detail: "Quote appears in more than one passage; the citation is ambiguous.",
      };
    }
  }

  if (claimedLocator && trueLocator && !locatorsAgree(claimedLocator, trueLocator)) {
    return {
      ok: false,
      failure: "locator_mismatch",
      originalQuote: options.sourceText.slice(start, end),
      start,
      end,
      locator: trueLocator,
      detail: `Model cited ${claimedLocator} but the passage is in ${trueLocator}.`,
    };
  }

  return {
    ok: true,
    // Display the document's wording, not the model's rendition of it.
    originalQuote: options.sourceText.slice(start, end),
    start,
    end,
    locator: trueLocator ?? claimedLocator ?? undefined,
  };
}

/** Which locator contains this original-text offset. */
export function locatorFor(offset: number, locators: Locator[]): string | null {
  for (const locator of locators) {
    if (offset >= locator.start && offset < locator.end) return locator.label;
  }
  return null;
}

/**
 * Compare a claimed locator to the derived one leniently.
 *
 * Models write "Paragraph 3", "paragraph 3", "P3" and "¶3" for the same
 * passage, so comparing the strings would reject correct citations over
 * formatting. The numbers are what carry the meaning, and a document is
 * either paragraph-addressed or page-addressed but never both — so matching
 * digits is enough to catch a real mismatch (page 2 cited as page 7) without
 * false rejections. A claimed locator with no digits at all tells us nothing,
 * so we accept it and let the derived locator stand.
 */
function locatorsAgree(claimed: string, actual: string): boolean {
  const digits = (value: string) => value.match(/\d+/g)?.join(".") ?? "";

  const claimedDigits = digits(claimed);
  if (claimedDigits === "") return true;

  return claimedDigits === digits(actual);
}

export interface VerifiedEvidence {
  evidence: Evidence[];
  rejected: Array<{ quote: string; locator: string | null; reason: string }>;
}

/**
 * Verify a batch of model citations, keeping the ones that pass and reporting
 * the ones that don't. Callers store `evidence` and surface `rejected` as a
 * validation note — the UI never silently drops a failed citation, because a
 * model that cites badly is a signal the user should see.
 */
export function verifyEvidenceList(
  claims: Array<{ quote: string; locator?: string | null; scopeItemId?: string }>,
  options: VerifyOptions,
): VerifiedEvidence {
  const normalized = options.normalized ?? normalize(options.sourceText);
  const evidence: Evidence[] = [];
  const rejected: VerifiedEvidence["rejected"] = [];

  for (const claim of claims) {
    const result = verifyQuote(claim.quote, claim.locator ?? null, {
      ...options,
      normalized,
    });

    if (result.ok && result.originalQuote !== undefined) {
      evidence.push({
        quote: result.originalQuote,
        locator: result.locator ?? "",
        scopeItemId: claim.scopeItemId,
        start: result.start!,
        end: result.end!,
        verified: true,
      });
    } else {
      rejected.push({
        quote: claim.quote,
        locator: claim.locator ?? null,
        reason: result.detail ?? "Citation could not be verified.",
      });
    }
  }

  return { evidence, rejected };
}

/**
 * Split pasted text into paragraph locators, or a PDF's pages into page
 * locators. Offsets are into the original string so evidence spans line up
 * with what the user sees in the source viewer.
 */
export function buildParagraphLocators(text: string): Locator[] {
  const locators: Locator[] = [];
  const pattern = /\n\s*\n/g;

  let start = 0;
  let index = 1;
  let match: RegExpExecArray | null;

  const push = (from: number, to: number) => {
    if (text.slice(from, to).trim().length === 0) return;
    locators.push({
      id: `p${index}`,
      kind: "paragraph",
      label: `Paragraph ${index}`,
      start: from,
      end: to,
    });
    index++;
  };

  while ((match = pattern.exec(text)) !== null) {
    push(start, match.index);
    start = match.index + match[0].length;
  }
  push(start, text.length);

  return locators;
}

export function buildPageLocators(pages: string[]): {
  text: string;
  locators: Locator[];
} {
  const locators: Locator[] = [];
  const parts: string[] = [];
  let offset = 0;

  pages.forEach((page, i) => {
    const start = offset;
    parts.push(page);
    offset += page.length;

    locators.push({
      id: `page${i + 1}`,
      kind: "page",
      label: `Page ${i + 1}`,
      start,
      end: offset,
    });

    if (i < pages.length - 1) {
      const separator = "\n\n";
      parts.push(separator);
      offset += separator.length;
    }
  });

  return { text: parts.join(""), locators };
}
