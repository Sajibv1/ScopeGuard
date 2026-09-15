/**
 * Memory matching (plan §10, Tier 2): when a real document — the client's
 * confirmed reply, or an SOW that finally arrived — is ingested over a notes
 * baseline, decide which remembered items it confirms.
 *
 * A memory item is confirmed only when the new document contains an extracted
 * item whose verified quote or description plainly restates the same thing.
 * This is deliberately deterministic word-matching, not a model call: the
 * decision affects what is presented as confirmed, so it must be explainable
 * and identical on every run. A borderline match resolves to "not confirmed"
 * — the honest direction — and the user reviews the flagged item anyway.
 */

import type { ScopeItem } from "../types.ts";

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "will", "be", "is", "are", "was", "were", "we", "our", "they", "their",
  "client", "call", "said", "says", "agreed", "agree", "notes", "recalled",
  "that", "this", "it", "as", "at", "by", "from", "up", "about", "into",
]);

/** Content words: lowercased, punctuation stripped, fillers dropped. */
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/** At least half the memory's content words appear in the candidate, min 2. */
const MATCH_RATIO = 0.5;
const MIN_HITS = 2;

/**
 * Does this candidate (an extracted item with a verified quote) restate the
 * remembered item? Matched against the candidate's description AND its quote
 * — the client may word the confirmation differently from the notes.
 */
export function matchesCandidate(
  memoryDescription: string,
  candidate: { description: string; quote: string | null },
): boolean {
  const memoryWords = contentWords(memoryDescription);
  if (memoryWords.length === 0) return false;

  const candidateWords = new Set([
    ...contentWords(candidate.description),
    ...(candidate.quote ? contentWords(candidate.quote) : []),
  ]);

  const hits = memoryWords.filter((word) => candidateWords.has(word)).length;
  return hits >= MIN_HITS && hits / memoryWords.length >= MATCH_RATIO;
}

/** True when any candidate confirms the remembered item. */
export function isConfirmedByAny(
  memoryDescription: string,
  candidates: Array<{ description: string; quote: string | null }>,
): boolean {
  return candidates.some((candidate) => matchesCandidate(memoryDescription, candidate));
}

/**
 * Split remembered items into those the new document confirms and those it
 * does not. Confirmed ones are superseded by the extracted items that carry
 * real quotes; unconfirmed ones carry forward, still provenance "memory",
 * where the review screen flags them.
 */
export function partitionMemoryItems(
  memoryItems: ScopeItem[],
  extracted: Array<{ description: string; quote: string | null }>,
): { confirmed: ScopeItem[]; unconfirmed: ScopeItem[] } {
  const confirmed: ScopeItem[] = [];
  const unconfirmed: ScopeItem[] = [];

  for (const item of memoryItems) {
    if (isConfirmedByAny(item.description, extracted)) {
      confirmed.push(item);
    } else {
      unconfirmed.push(item);
    }
  }

  return { confirmed, unconfirmed };
}
