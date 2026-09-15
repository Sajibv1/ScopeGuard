/**
 * Deterministic document rendering.
 *
 * Plan §9: "Use a deterministic document template for totals, dates, IDs, and
 * estimate tables. Let AI draft narrative sections only."
 *
 * This module is that template. It takes stored records and produces the
 * rendered document. Model-written prose enters only through `sections`, and
 * every number, date and identifier is computed here from the database. The
 * on-screen view and the export both call `renderChangeOrder`, which is what
 * makes "exported totals exactly match on-screen totals" structurally true.
 */

import {
  computeTotals,
  formatDecimal,
  formatHours,
  formatMoney,
  fromDbNumeric,
} from "@/lib/money";
import { ASSESSMENT_LABEL_TEXT } from "@/lib/types";
import type {
  AssessmentLabel,
  ChangeRequest,
  DocumentVersion,
  EstimateItem,
  Project,
  ReviewableItem,
  ScopeVersion,
  Tone,
} from "@/lib/types";

export interface RenderInput {
  project: Project;
  request: ChangeRequest;
  scopeVersion: ScopeVersion;
  items: ReviewableItem[];
  estimateItems: EstimateItem[];
  document: DocumentVersion | null;
  /** Include internal review notes. Off by default — exports must not leak them. */
  includeInternalNotes?: boolean;
  /**
   * True when the baseline text is a human-reviewed OCR transcription rather
   * than the document's own text layer. Every export must say so: a reader
   * deciding whether to sign needs to know quotes come from a transcription.
   */
  sourceIsTranscribed?: boolean;
  /** Baseline is a reviewed call transcript (§10) — distinct wording from OCR. */
  sourceIsTranscript?: boolean;
  /**
   * True when the baseline version still contains memory items from a notes
   * recap (§10 Tier 2). The reader deciding whether to sign must know part
   * of the baseline is the freelancer's unconfirmed recollection.
   */
  baselineIncludesMemory?: boolean;
}

export interface RenderedLine {
  description: string;
  hours: string;
  rate: string;
  total: string;
  linkedItem: string | null;
}

export interface RenderedChangeOrder {
  reference: string;
  projectName: string;
  clientName: string | null;
  preparedOn: string;
  baselineLabel: string;
  currency: string;
  requestedChanges: Array<{
    title: string;
    description: string;
    label: AssessmentLabel;
    labelText: string;
    /** True when the label came from the user overriding the model. */
    userDecided: boolean;
    /** True when the user's decision rests on context outside the document. */
    contextBased: boolean;
    note: string | null;
  }>;
  lines: RenderedLine[];
  subtotal: string;
  /** User-entered tax label, e.g. "VAT". Null when no tax rate is set. */
  taxLabel: string | null;
  /** The user-entered rate, display-formatted (e.g. "8.25%"). */
  taxRate: string | null;
  /** Computed tax amount. Null when no rate is set — no row is rendered then. */
  taxAmount: string | null;
  /** Subtotal plus tax. Rendered wherever a grand total is owed. */
  total: string;
  hasEstimate: boolean;
  estimateIncomplete: boolean;
  openQuestions: string[];
  sections: Record<string, string>;
  decisionStatus: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return DATE_FORMAT.format(new Date(iso));
}

/**
 * The final label for an item.
 *
 * The user's review always wins over the model's proposal. When there is no
 * review the item is UNREVIEWED — the caller must treat that as blocking
 * finalization rather than silently adopting the model's answer.
 */
export function finalLabel(entry: ReviewableItem): AssessmentLabel | null {
  if (entry.review) return entry.review.finalLabel;
  return null;
}

export function proposedLabel(entry: ReviewableItem): AssessmentLabel | null {
  return entry.assessment?.proposedLabel ?? null;
}

export function isReviewed(entry: ReviewableItem): boolean {
  return entry.review !== null;
}

export function renderChangeOrder(input: RenderInput): RenderedChangeOrder {
  const { project, request, scopeVersion, items, estimateItems, document } = input;

  // The tax rate is user-entered on the change request; amounts are always
  // computed, never stored, so this is the same figure everywhere it appears.
  const taxRate = fromDbNumeric(request.taxRate);
  const totals = computeTotals(estimateItems, taxRate);

  // Parsing goes through fromDbNumeric so the rendered figures come from the
  // same arithmetic as computeTotals. A second local parser here would be
  // free to drift, which is precisely the bug this module exists to prevent.
  const lines: RenderedLine[] = estimateItems.map((item, index) => ({
    description: item.description,
    hours: formatHours(fromDbNumeric(item.hours)),
    rate: item.rate === null ? "—" : formatMoney(fromDbNumeric(item.rate)!, project.currency),
    total: formatMoney(totals.lines[index] ?? 0n, project.currency),
    linkedItem:
      items.find((entry) => entry.item.id === item.requestItemId)?.item.title ?? null,
  }));

  const requestedChanges = items.map((entry) => {
    const label = finalLabel(entry) ?? entry.assessment?.proposedLabel ?? "needs_clarification";

    return {
      title: entry.item.title,
      description: entry.item.description,
      label,
      labelText: ASSESSMENT_LABEL_TEXT[label],
      userDecided:
        entry.review !== null &&
        entry.assessment !== null &&
        entry.review.finalLabel !== entry.assessment.proposedLabel,
      contextBased: entry.review?.userContextBased ?? false,
      // Internal notes never reach an export unless explicitly requested.
      note: input.includeInternalNotes ? (entry.review?.note ?? null) : null,
    };
  });

  const openQuestions = items
    .filter((entry) => (finalLabel(entry) ?? entry.assessment?.proposedLabel) === "needs_clarification")
    .map((entry) => entry.assessment?.suggestedQuestion)
    .filter((question): question is string => Boolean(question));

  return {
    reference: request.reference,
    projectName: project.name,
    clientName: project.clientName,
    preparedOn: formatDate(new Date().toISOString()),
    baselineLabel: `Baseline version ${scopeVersion.version}, confirmed ${formatDate(scopeVersion.confirmedAt)}${
      input.sourceIsTranscript
        ? " · transcript of a call, reviewed"
        : input.sourceIsTranscribed
          ? " · machine-transcribed (OCR), reviewed"
          : ""
    }${input.baselineIncludesMemory ? " · includes unconfirmed items from your notes" : ""}`,
    currency: project.currency,
    requestedChanges,
    lines,
    subtotal: formatMoney(totals.subtotal, project.currency),
    taxLabel: request.taxLabel,
    taxRate: taxRate === null ? null : `${formatDecimal(taxRate)}%`,
    taxAmount: totals.tax === null ? null : formatMoney(totals.tax, project.currency),
    total: formatMoney(totals.total, project.currency),
    hasEstimate: estimateItems.length > 0,
    estimateIncomplete: totals.incomplete,
    openQuestions,
    sections: document?.sections ?? {},
    decisionStatus: statusText(request),
  };
}

function statusText(request: ChangeRequest): string {
  switch (request.status) {
    case "draft":
      return "Draft — not yet sent";
    case "ready":
      return "Ready to send";
    case "sent":
      return `Sent ${formatDate(request.sentAt)}`;
    case "approved":
      // Never implies a verified signature (plan §10).
      return `Approval recorded by user ${formatDate(request.decidedAt)}`;
    case "declined":
      return `Declined ${formatDate(request.decidedAt)}`;
  }
}

// ── Client reply ────────────────────────────────────────────────────────────

export interface RenderedReply {
  subject: string;
  body: string;
}

const REPLY_ORDER = [
  "reply_acknowledgement",
  "reply_covered",
  "reply_additional",
  "reply_questions",
  "reply_next_step",
] as const;

/**
 * Assemble the client reply as plain text ready to paste into an email.
 *
 * The estimate line is rendered here from stored totals rather than taken
 * from the model's prose, so the figure in the email is always the figure in
 * the database.
 */
export function renderClientReply(
  input: RenderInput & { tone?: Tone },
): RenderedReply {
  const rendered = renderChangeOrder(input);
  const sections = input.document?.sections ?? {};

  const paragraphs: string[] = [];

  for (const key of REPLY_ORDER) {
    const text = sections[key]?.trim();
    if (!text) continue;

    paragraphs.push(text);

    // Insert the deterministic figure directly after the "additional work"
    // paragraph, where the model was told to refer to "the breakdown below".
    if (key === "reply_additional" && rendered.hasEstimate && !rendered.estimateIncomplete) {
      paragraphs.push(renderEstimateBlock(rendered));
    }
  }

  if (rendered.openQuestions.length > 0) {
    paragraphs.push(rendered.openQuestions.map((question) => `- ${question}`).join("\n"));
  }

  return {
    subject: `${rendered.reference}: ${input.request.title}`,
    body: paragraphs.join("\n\n"),
  };
}

function renderEstimateBlock(rendered: RenderedChangeOrder): string {
  const lines = rendered.lines.map(
    (line) => `- ${line.description}: ${line.hours} h × ${line.rate} = ${line.total}`,
  );

  // The tax row names its label and rate so the client can see the figure is
  // derived from a rate the developer entered, not invented by the tool.
  const taxRow =
    rendered.taxAmount === null
      ? []
      : [`${rendered.taxLabel ?? "Tax"} (${rendered.taxRate ?? "—"}): ${rendered.taxAmount}`];

  const totalRow = rendered.taxAmount === null
    ? [`Total: ${rendered.total} ${rendered.currency}`]
    : [`Subtotal: ${rendered.subtotal}`, ...taxRow, `Total: ${rendered.total} ${rendered.currency}`];

  return [...lines, ...totalRow].join("\n");
}

// ── Finalization gate ───────────────────────────────────────────────────────

export interface FinalizationCheck {
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Plan §9: a final, ready-to-send change order requires all assessment items
 * reviewed, selected paid work estimated, and no unresolved clarification item
 * presented as settled fact.
 *
 * Blockers prevent finalization. Warnings do not — a draft is allowed to carry
 * open questions, it just cannot be called final while pretending otherwise.
 */
export function checkFinalization(
  items: ReviewableItem[],
  estimateItems: EstimateItem[],
): FinalizationCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const unreviewed = items.filter((entry) => !isReviewed(entry));
  if (unreviewed.length > 0) {
    blockers.push(
      `${unreviewed.length} item${unreviewed.length === 1 ? "" : "s"} still ${
        unreviewed.length === 1 ? "needs" : "need"
      } your review: ${unreviewed.map((entry) => entry.item.title).join(", ")}.`,
    );
  }

  const additional = items.filter((entry) => finalLabel(entry) === "potentially_additional");
  const estimated = new Set(
    estimateItems.filter((item) => item.hours !== null).map((item) => item.requestItemId),
  );

  const unestimated = additional.filter((entry) => !estimated.has(entry.item.id));
  if (unestimated.length > 0) {
    blockers.push(
      `Additional work needs hours entered: ${unestimated
        .map((entry) => entry.item.title)
        .join(", ")}.`,
    );
  }

  const missingHours = estimateItems.filter((item) => item.hours === null);
  if (missingHours.length > 0) {
    blockers.push(
      `${missingHours.length} estimate line${missingHours.length === 1 ? " has" : "s have"} no hours entered.`,
    );
  }

  const unresolved = items.filter((entry) => finalLabel(entry) === "needs_clarification");
  if (unresolved.length > 0) {
    warnings.push(
      `${unresolved.length} item${unresolved.length === 1 ? " is" : "s are"} still awaiting clarification. The reply will ask about ${
        unresolved.length === 1 ? "it" : "them"
      } rather than treating ${unresolved.length === 1 ? "it" : "them"} as settled.`,
    );
  }

  return { ready: blockers.length === 0, blockers, warnings };
}

export { formatDecimal };
