/**
 * Evidence highlighting geometry.
 *
 * Pure offset arithmetic, kept out of the React component so it can be tested
 * directly (Node cannot strip JSX) and so the rendering layer stays thin.
 *
 * Highlights are applied by CHARACTER OFFSET, never by re-searching the text
 * for the quote. The offsets come from the citation validator, which already
 * resolved which occurrence of a phrase the evidence refers to; searching
 * again here could land on a different occurrence and point the user at the
 * wrong clause.
 */

export interface Highlight {
  id: string;
  start: number;
  end: number;
}

export interface Segment {
  text: string;
  /** Ids of every highlight covering this run. Empty for plain text. */
  ids: string[];
}

/**
 * Split text into runs that share the same set of covering highlights.
 *
 * Uses a boundary sweep rather than nesting, so overlapping spans (two items
 * citing the same sentence) produce one run carrying both ids instead of
 * invalid nested markup or double-shaded text.
 *
 * Guarantees that the concatenated segments equal the input exactly — the
 * source viewer must never alter the document it is displaying.
 */
export function buildSegments(text: string, highlights: Highlight[]): Segment[] {
  const valid = highlights
    .filter(
      (highlight) =>
        Number.isFinite(highlight.start) &&
        Number.isFinite(highlight.end) &&
        highlight.end > highlight.start &&
        highlight.end > 0 &&
        highlight.start < text.length,
    )
    .map((highlight) => ({
      id: highlight.id,
      start: Math.max(0, highlight.start),
      end: Math.min(text.length, highlight.end),
    }));

  if (valid.length === 0) return [{ text, ids: [] }];

  const boundaries = new Set<number>([0, text.length]);
  for (const highlight of valid) {
    boundaries.add(highlight.start);
    boundaries.add(highlight.end);
  }

  const points = [...boundaries].sort((a, b) => a - b);
  const segments: Segment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]!;
    const end = points[i + 1]!;
    if (end <= start) continue;

    const ids = valid
      .filter((highlight) => highlight.start <= start && highlight.end >= end)
      .map((highlight) => highlight.id);

    segments.push({ text: text.slice(start, end), ids });
  }

  return segments;
}
