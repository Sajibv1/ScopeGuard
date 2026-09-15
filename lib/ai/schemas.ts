/**
 * Structured output schemas for the three AI operations (plan §5).
 *
 * Every schema is strict: OpenAI's `json_schema` strict mode guarantees the
 * SHAPE, and these zod schemas re-validate at runtime because shape guarantees
 * are not content guarantees. A structurally perfect response can still cite a
 * quote that does not exist — that is what lib/ai/citations.ts is for.
 *
 * Strict mode requires every property to be listed in `required`, so optional
 * fields are modelled as `.nullable()` rather than `.optional()`.
 */

import { z } from "zod";

import { ASSESSMENT_LABELS, SCOPE_CATEGORIES, TRANSCRIPT_COMMITMENTS } from "../types.ts";

/** A citation as CLAIMED by the model. Unverified until citations.ts says so. */
export const EvidenceClaimSchema = z.object({
  quote: z
    .string()
    .describe("Exact verbatim text copied from the source document. Do not paraphrase."),
  locator: z
    .string()
    .describe("The paragraph or page label containing this quote, e.g. 'Paragraph 3'."),
});

export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;

// ── Operation A: extract baseline scope ─────────────────────────────────────

export const ScopeExtractionSchema = z.object({
  items: z
    .array(
      z.object({
        category: z.enum(SCOPE_CATEGORIES),
        description: z
          .string()
          .describe("A neutral one-sentence restatement of what the scope says."),
        quote: z
          .string()
          .describe("Exact verbatim supporting text from the document."),
        locator: z.string().describe("Paragraph or page label for the quote."),
      }),
    )
    .describe("One entry per distinct scope commitment found in the document."),
});

export type ScopeExtraction = z.infer<typeof ScopeExtractionSchema>;

/**
 * Transcript variant (plan §10, Tier 1): identical to scope extraction plus
 * the commitment judgement. In a spoken conversation a verified quote proves
 * something was said, not that anyone committed — so the commitment is a
 * separate field, and only "agreed" items are presented as commitments.
 */
export const TranscriptScopeExtractionSchema = z.object({
  items: z
    .array(
      z.object({
        category: z.enum(SCOPE_CATEGORIES),
        description: z
          .string()
          .describe("A neutral one-sentence restatement of what was said."),
        quote: z
          .string()
          .describe("Exact verbatim supporting text from the transcript."),
        locator: z.string().describe("Timestamp label for the quote."),
        commitment: z
          .enum(TRANSCRIPT_COMMITMENTS)
          .describe(
            "How firmly the client committed: agreed (a clear yes), discussed (no commitment either way), or suggested (someone floated an idea).",
          ),
      }),
    )
    .describe("One entry per distinct scope commitment found in the transcript."),
});

export type TranscriptScopeExtraction = z.infer<typeof TranscriptScopeExtractionSchema>;

/**
 * No-source variant (plan §10, Tier 2): the user's rough notes. There are no
 * quote or locator fields — not "optional", absent — so a model that tries to
 * attach a "quote" to a memory has it stripped by validation. Memory is not
 * evidence and can never be quoted as if it were.
 */
export const NotesScopeExtractionSchema = z.object({
  items: z
    .array(
      z.object({
        category: z.enum(SCOPE_CATEGORIES),
        description: z
          .string()
          .describe("A neutral one-sentence restatement of what the notes recall."),
      }),
    )
    .describe("One entry per distinct scope recollection found in the notes."),
});

export type NotesScopeExtraction = z.infer<typeof NotesScopeExtractionSchema>;

// ── Operation B: decompose and compare ──────────────────────────────────────

export const RequestAnalysisSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().describe("Short imperative title, e.g. 'Add Google login'."),
        description: z
          .string()
          .describe("One or two sentences describing only what the client asked for."),
        source_excerpt: z
          .string()
          .describe(
            "Exact verbatim span from the client message that this item comes from.",
          ),
        label: z.enum(ASSESSMENT_LABELS),
        explanation: z
          .string()
          .describe("Plain-language reasoning, at most three sentences."),
        supporting_evidence: z
          .array(EvidenceClaimSchema)
          .describe("Scope quotes that support the label. Empty if none exist."),
        conflicting_evidence: z
          .array(EvidenceClaimSchema)
          .describe("Scope quotes that point the other way. Empty if none exist."),
        missing_information: z
          .array(z.string())
          .describe("Facts needed to decide. Empty when the evidence is sufficient."),
        suggested_question: z
          .string()
          .nullable()
          .describe("One concrete question for the client or user, or null."),
      }),
    )
    .describe("One entry per atomic request found in the client message."),
});

export type RequestAnalysis = z.infer<typeof RequestAnalysisSchema>;

// ── Operation B (suggestions): work components ──────────────────────────────

/**
 * Work-component suggestions for the estimate screen. Note there is no hours
 * field anywhere in this schema — the plan is explicit that hours stay blank
 * until the user enters them, so the model is never given a slot to fill.
 */
export const WorkBreakdownSchema = z.object({
  components: z
    .array(
      z.object({
        request_item_title: z
          .string()
          .describe("Title of the request item this work belongs to."),
        description: z
          .string()
          .describe("One concrete unit of work, e.g. 'Implement OAuth callback flow'."),
      }),
    )
    .describe("Suggested work components. Never include time or price."),
});

export type WorkBreakdown = z.infer<typeof WorkBreakdownSchema>;

// ── Operation B (suggestions): reference hours ──────────────────────────────

/**
 * Rough reference figures for estimate lines (§8 "AI-generated hours", honest
 * version).
 *
 * The output of this schema is DISPLAY-ONLY. It is stored in
 * ai_hour_suggestions, never in estimate_items.hours, and never enters a
 * total. The user must type their own figure regardless — which is why the
 * draft includes a rationale the user can accept or reject on its merits.
 */
export const HourSuggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        estimate_line: z
          .string()
          .describe("The estimate line description this draft is for, copied exactly."),
        draft_hours: z
          .number()
          .min(0)
          .max(1000)
          .describe(
            "A rough reference figure for comparable work, e.g. 6 or 4.5. Round honestly — do not present precision you lack.",
          ),
        rationale: z
          .string()
          .describe(
            "One sentence on what typically drives the figure, e.g. 'Callback handling and account linking are each usually about a day.'",
          ),
      }),
    )
    .describe("One draft per estimate line given."),
});

export type HourSuggestions = z.infer<typeof HourSuggestionsSchema>;

// ── Operation B (suggestions): legal topic flags ────────────────────────────

/**
 * Contract-adjacent topics worth professional review (§8 "automatic legal
 * conclusions", honest version).
 *
 * The model names TOPICS and describes why a professional might look at them.
 * It never concludes anything: notes containing breach, liability,
 * enforceability or similar assertions are rejected by validation and, if the
 * retry still fails, dropped. Flags are internal and never reach an export.
 */
export const LegalFlagsSchema = z.object({
  flags: z
    .array(
      z.object({
        request_item_title: z
          .string()
          .describe("Title of the request item this flag belongs to, copied exactly."),
        topic: z
          .string()
          .describe(
            "A short topic name, e.g. 'indemnification', 'IP ownership', 'warranty', 'data protection'.",
          ),
        note: z
          .string()
          .describe(
            "One or two neutral sentences on why the topic may deserve professional attention. Describe the topic; do not conclude anything about breach, liability, or enforceability.",
          ),
      }),
    )
    .describe("Topics worth professional review. Empty when none apply."),
});

export type LegalFlags = z.infer<typeof LegalFlagsSchema>;

// ── Operation C: draft communication ────────────────────────────────────────

/**
 * Narrative sections only. Totals, dates, identifiers and the estimate table
 * are rendered deterministically from stored data (plan §9), so there is no
 * field here for the model to put a number in.
 */
export const DocumentDraftSchema = z.object({
  reply_acknowledgement: z
    .string()
    .describe("One or two sentences acknowledging the client's message."),
  reply_covered: z
    .string()
    .describe("What the agreement already covers. Empty string if nothing does."),
  reply_additional: z
    .string()
    .describe("What appears to be additional work. Empty string if nothing is."),
  reply_questions: z
    .string()
    .describe("Open questions, as prose. Empty string if there are none."),
  reply_next_step: z.string().describe("The single next step being requested."),
  change_order_summary: z
    .string()
    .describe("Neutral summary of the requested changes for the change order."),
  change_order_assumptions: z
    .string()
    .describe("Assumptions the estimate rests on. Empty string if none."),
  change_order_exclusions: z
    .string()
    .describe("What this change order does not cover. Empty string if none."),
});

export type DocumentDraft = z.infer<typeof DocumentDraftSchema>;

export const DRAFT_REPLY_SECTIONS = [
  "reply_acknowledgement",
  "reply_covered",
  "reply_additional",
  "reply_questions",
  "reply_next_step",
] as const satisfies ReadonlyArray<keyof DocumentDraft>;

export const DRAFT_ORDER_SECTIONS = [
  "change_order_summary",
  "change_order_assumptions",
  "change_order_exclusions",
] as const satisfies ReadonlyArray<keyof DocumentDraft>;

export const SECTION_TITLES: Record<keyof DocumentDraft, string> = {
  reply_acknowledgement: "Acknowledgement",
  reply_covered: "What is covered",
  reply_additional: "What appears to be additional",
  reply_questions: "Open questions",
  reply_next_step: "Next step",
  change_order_summary: "Summary of requested changes",
  change_order_assumptions: "Assumptions",
  change_order_exclusions: "Exclusions",
};
