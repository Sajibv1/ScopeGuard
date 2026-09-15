/**
 * Operation A — extract baseline scope (plan §5).
 *
 * Model output is never trusted directly: every extracted item must carry a
 * quote that verifies against the source document, or it is dropped and
 * reported. The user then confirms what survives, which is what makes the
 * baseline theirs rather than the model's.
 */

import "server-only";

import { normalize, verifyQuote, type NormalizedText } from "./citations.ts";
import { generate, type ModelCache, type ModelResult } from "./provider.ts";
import { fixtureScopeExtraction, fixtureTranscriptExtraction } from "./fixtures.ts";
import {
  EXTRACT_SCOPE_SYSTEM,
  EXTRACT_TRANSCRIPT_SYSTEM,
  extractScopeUser,
  extractTranscriptUser,
  PROMPT_VERSIONS,
} from "./prompts.ts";
import {
  ScopeExtractionSchema,
  TranscriptScopeExtractionSchema,
  type ScopeExtraction,
} from "./schemas.ts";
import type { Locator, ScopeCategory, TranscriptCommitment } from "../types.ts";

export interface ExtractedScopeItem {
  category: ScopeCategory;
  description: string;
  sourceQuote: string;
  sourceLocator: string;
  quoteStart: number;
  quoteEnd: number;
  /** Transcript documents only: how firmly the client committed. */
  commitment: TranscriptCommitment | null;
}

export interface ScopeExtractionResult {
  items: ExtractedScopeItem[];
  /** Citations that failed verification, surfaced to the user as a warning. */
  rejected: Array<{ description: string; reason: string }>;
  model: string;
  promptVersion: string;
  fixture: boolean;
  usage: ModelResult<unknown>["usage"];
}

export function locatorGuide(locators: Locator[], text: string): string {
  return locators
    .map((locator) => {
      const preview = text.slice(locator.start, locator.start + 90).replace(/\s+/g, " ");
      return `- ${locator.label}: "${preview}${locator.end - locator.start > 90 ? "..." : ""}"`;
    })
    .join("\n");
}

function labelFor(locators: Locator[]): (offset: number) => string {
  return (offset) => {
    for (const locator of locators) {
      if (offset >= locator.start && offset < locator.end) return locator.label;
    }
    return locators[0]?.label ?? "Paragraph 1";
  };
}

/**
 * Verify every proposed item against the source document and split the
 * survivors from the rejects. Shared by the live path and the fixture path so
 * a fixture citation is held to exactly the same standard as a model's.
 * Accepts document-shaped and transcript-shaped items alike; a commitment
 * label survives verification untouched — it is a judgement for the user to
 * review, not a claim the quote checker can settle.
 */
function verifyExtractionItems(
  data: {
    items: ReadonlyArray<{
      category: ScopeCategory;
      description: string;
      quote: string;
      locator: string;
      commitment?: TranscriptCommitment;
    }>;
  },
  documentText: string,
  locators: Locator[],
): { items: ExtractedScopeItem[]; rejected: ScopeExtractionResult["rejected"] } {
  const normalized = normalize(documentText);
  const items: ExtractedScopeItem[] = [];
  const rejected: ScopeExtractionResult["rejected"] = [];

  for (const item of data.items) {
    const check = verifyQuote(item.quote, item.locator, {
      sourceText: documentText,
      locators,
      normalized,
    });

    if (!check.ok || check.originalQuote === undefined) {
      rejected.push({
        description: item.description,
        reason: check.detail ?? "Citation could not be verified.",
      });
      continue;
    }

    items.push({
      category: item.category,
      description: item.description,
      sourceQuote: check.originalQuote,
      sourceLocator: check.locator ?? item.locator,
      quoteStart: check.start!,
      quoteEnd: check.end!,
      commitment: item.commitment ?? null,
    });
  }

  return { items: dedupe(items), rejected };
}

export async function extractScope(
  documentText: string,
  locators: Locator[],
  cache?: ModelCache,
  opts?: { transcript?: boolean },
): Promise<ScopeExtractionResult> {
  const normalized = normalize(documentText);
  const transcript = opts?.transcript === true;

  const result = transcript
    ? await generate({
        operation: "extract",
        system: EXTRACT_TRANSCRIPT_SYSTEM,
        user: extractTranscriptUser(documentText, locatorGuide(locators, documentText)),
        schema: TranscriptScopeExtractionSchema,
        schemaName: "transcript_scope_extraction",
        cache,
        fixture: () => fixtureTranscriptExtraction(documentText, labelFor(locators)),
        validate: quoteValidator(documentText, locators, normalized, "transcript"),
      })
    : await generate({
        operation: "extract",
        system: EXTRACT_SCOPE_SYSTEM,
        user: extractScopeUser(documentText, locatorGuide(locators, documentText)),
        schema: ScopeExtractionSchema,
        schemaName: "scope_extraction",
        cache,
        fixture: () => fixtureScopeExtraction(documentText, labelFor(locators)),
        // Retry once if the model quoted text that is not in the document. This is
        // the cheapest place to catch a hallucinated citation — before it ever
        // reaches the database.
        validate: quoteValidator(documentText, locators, normalized, "agreement"),
      });

  const { items, rejected } = verifyExtractionItems(
    result.data,
    documentText,
    locators,
  );

  return {
    items,
    rejected,
    model: result.model,
    promptVersion: transcript
      ? PROMPT_VERSIONS.extract_scope_transcript
      : PROMPT_VERSIONS.extract_scope,
    fixture: result.fixture,
    usage: result.usage,
  };
}

/** Shared retry validator: every quote must appear verbatim in the source. */
function quoteValidator(
  documentText: string,
  locators: Locator[],
  normalized: NormalizedText,
  sourceName: string,
): (data: { items: Array<{ quote: string; locator: string }> }) => string | null {
  return (data) => {
    const bad = data.items.filter(
      (item) =>
        !verifyQuote(item.quote, item.locator, {
          sourceText: documentText,
          locators,
          normalized,
        }).ok,
    );

    if (bad.length === 0) return null;
    if (bad.length === data.items.length) {
      return `None of your quotes appear verbatim in the ${sourceName}. Copy exact text from between the ${sourceName.toUpperCase()} markers.`;
    }
    return `${bad.length} of ${data.items.length} quotes do not appear verbatim in the ${sourceName}, including "${bad[0]!.quote.slice(0, 60)}". Copy exact text.`;
  };
}

/**
 * Deterministic extraction used as the sample seed's fallback when the live
 * model's output cannot be verified even after its retry.
 *
 * The result goes through verifyExtractionItems — the same verification as
 * live output — and is marked `fixture: true` so anything recording or
 * displaying it can say where it came from. This is the demo-seed safety
 * net, not a general user-facing fallback: a real user's failed extraction
 * still surfaces as a failed run (see generate()'s contract).
 */
export function extractScopeFixture(
  documentText: string,
  locators: Locator[],
): ScopeExtractionResult {
  const data = fixtureScopeExtraction(documentText, labelFor(locators));
  const { items, rejected } = verifyExtractionItems(data, documentText, locators);

  return {
    items,
    rejected,
    model: "fixture",
    promptVersion: PROMPT_VERSIONS.extract_scope,
    fixture: true,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0, attempts: 1 },
  };
}

/** Two items quoting the same span are one item. */
function dedupe(items: ExtractedScopeItem[]): ExtractedScopeItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.quoteStart}:${item.quoteEnd}:${item.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
