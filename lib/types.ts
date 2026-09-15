/**
 * Shared domain types.
 *
 * These mirror the database schema in supabase/migrations/0001_init.sql.
 * The important structural rule (plan §4) is visible here: `Assessment` is
 * model output, `ItemReview` is the human decision, and they are never merged
 * into one object. Anything user-facing that needs "the answer" must go
 * through `finalLabel()` in lib/domain/review.ts, which makes the precedence
 * explicit rather than leaving it to whichever object a component happens
 * to hold.
 */

export const SCOPE_CATEGORIES = [
  "deliverable",
  "included_functionality",
  "exclusion",
  "quantity_limit",
  "revision_limit",
  "constraint",
  "client_responsibility",
  "milestone",
] as const;

export type ScopeCategory = (typeof SCOPE_CATEGORIES)[number];

/**
 * How firmly a client committed to something in a SPOKEN conversation (plan
 * §10). Quote verification proves something was said; only this label plus
 * the user's confirmation can make it a commitment. Non-transcript items
 * carry null.
 */
export const TRANSCRIPT_COMMITMENTS = ["agreed", "discussed", "suggested"] as const;

export type TranscriptCommitment = (typeof TRANSCRIPT_COMMITMENTS)[number];

export const TRANSCRIPT_COMMITMENT_LABELS: Record<TranscriptCommitment, string> = {
  agreed: "Agreed in the call",
  discussed: "Discussed, not committed",
  suggested: "Suggested, not committed",
};

export const SCOPE_CATEGORY_LABELS: Record<ScopeCategory, string> = {
  deliverable: "Deliverable",
  included_functionality: "Included functionality",
  exclusion: "Exclusion",
  quantity_limit: "Quantity limit",
  revision_limit: "Revision limit",
  constraint: "Constraint",
  client_responsibility: "Client responsibility",
  milestone: "Milestone",
};

export const ASSESSMENT_LABELS = [
  "included",
  "potentially_additional",
  "needs_clarification",
] as const;

export type AssessmentLabel = (typeof ASSESSMENT_LABELS)[number];

/**
 * Display text for each label. Deliberately hedged: "potentially additional",
 * not "out of scope". ScopeGuard does not determine legal enforceability
 * (plan §1).
 */
export const ASSESSMENT_LABEL_TEXT: Record<AssessmentLabel, string> = {
  included: "Included",
  potentially_additional: "Potentially additional",
  needs_clarification: "Needs clarification",
};

export const REQUEST_STATUSES = [
  "draft",
  "ready",
  "sent",
  "approved",
  "declined",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Display text for change-request status badges, shared across surfaces. */
export const REQUEST_STATUS_TEXT: Record<RequestStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  sent: "Sent",
  approved: "Approved",
  declined: "Declined",
};

/**
 * Processing state, kept strictly separate from business status so that
 * "analysis failed" can never render as a business outcome (plan §10).
 */
export type AnalysisStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "invalid_output";

export type AiOperation = "extract_scope" | "analyze_request" | "draft_documents";

export type DocumentKind = "client_reply" | "change_order";

export type Tone = "friendly" | "formal";

export type SourceKind = "paste" | "pdf" | "transcript" | "recap";

// ── Team roles (§8 "Team roles / approval chains") ───────────────────────────

export const MEMBER_ROLES = ["admin", "approver", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_ROLE_TEXT: Record<MemberRole, string> = {
  admin: "Admin — manage the team and approve",
  approver: "Approver — review and approve change orders",
  viewer: "Viewer — read-only",
};

/**
 * What the signed-in user can do with a project: "owner" is the account that
 * created it (full control); a member role grants read access plus, for
 * approvers and admins, the ability to record internal approvals.
 */
export type ProjectRole = "owner" | MemberRole;

/** A team membership row. The owner is synthesized separately, never stored. */
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: MemberRole;
  addedBy: string | null;
  createdAt: string;
}

/** An invite link — the token is the capability and it is single-use. */
export interface ProjectInvite {
  id: string;
  projectId: string;
  token: string;
  role: MemberRole;
  createdBy: string;
  acceptedAt: string | null;
  createdAt: string;
}

/**
 * An internal sign-off on a change request, recorded by a teammate before the
 * owner sends it to the client. A record of a human act — never a signature.
 */
export interface ChangeApproval {
  id: string;
  changeRequestId: string;
  approverId: string;
  role: MemberRole;
  decision: "approved" | "changes_requested";
  note: string | null;
  createdAt: string;
}

/** Per-page OCR record, kept as the machine produced it (audit trail). */
export interface OcrPageRecord {
  page: number;
  text: string;
  confidence: number;
  characters: number;
}

/** A addressable region of the source document, used for evidence locators. */
export interface Locator {
  id: string;
  kind: "paragraph" | "page" | "timestamp";
  label: string;
  start: number;
  end: number;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  clientName: string | null;
  description: string | null;
  currency: string;
  defaultRate: string | null;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeDocument {
  id: string;
  projectId: string;
  title: string;
  sourceKind: SourceKind;
  storagePath: string | null;
  extractedText: string;
  locators: Locator[];
  /**
   * True when extracted_text is an OCR transcription rather than a PDF text
   * layer or a paste. Evidence drawn from this document is evidence against a
   * REVIEWED TRANSCRIPTION, and every surface that shows it must say so.
   */
  ocrApplied: boolean;
  /** Mean per-page recognition confidence, 0–100. Null unless ocrApplied. */
  ocrConfidence: number | null;
  /** When a human confirmed the transcription. DB CHECK: set iff ocrApplied. */
  ocrReviewedAt: string | null;
  /**
   * True when extracted_text is a transcript of a spoken conversation — a
   * pasted Zoom/Meet transcript or a machine transcription of uploaded
   * audio. A transcript is evidence of what was SAID, not of what was
   * signed, and every surface that shows it must say so.
   */
  transcriptApplied: boolean;
  /** When a human reviewed the transcript. DB CHECK: set iff transcriptApplied. */
  transcriptReviewedAt: string | null;
  /**
   * When the call the notes describe took place. Only meaningful when
   * sourceKind is "recap" — the user's own rough notes, not an agreement.
   */
  callDate: string | null;
  /** Who was on that call. Only meaningful when sourceKind is "recap". */
  participants: string | null;
  createdAt: string;
}

export interface ScopeVersion {
  id: string;
  projectId: string;
  documentId: string;
  version: number;
  confirmedAt: string | null;
  createdAt: string;
}

export interface ScopeItem {
  id: string;
  scopeVersionId: string;
  category: ScopeCategory;
  description: string;
  sourceQuote: string | null;
  sourceLocator: string | null;
  quoteStart: number | null;
  quoteEnd: number | null;
  /** True when the user supplied this without document evidence. */
  userAdded: boolean;
  /** How firmly the client committed, for transcript-derived items. Null otherwise. */
  commitment: TranscriptCommitment | null;
  /**
   * "memory" marks an item proposed from the user's rough notes (recap
   * flow): it has no source quote, is never evidence, and stays visibly
   * unverified until a client reply confirms it. "document" is everything
   * else, including items the user typed during review.
   */
  provenance: "document" | "memory";
  confirmed: boolean;
  sortOrder: number;
}

export interface ChangeRequest {
  id: string;
  projectId: string;
  scopeVersionId: string;
  reference: string;
  title: string;
  clientMessage: string;
  receivedOn: string | null;
  sourceLabel:
    | "email"
    | "chat"
    | "call_notes"
    | "voice_note"
    | "video"
    | "screenshot"
    | "other"
    | null;
  status: RequestStatus;
  userContext: string | null;
  /**
   * Tax label and rate, entered by the user (e.g. "VAT", 8.25). Null rate
   * means no tax is applied anywhere. The application computes the amount;
   * it never chooses the rate.
   */
  taxLabel: string | null;
  taxRate: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestItem {
  id: string;
  changeRequestId: string;
  title: string;
  description: string;
  sourceExcerpt: string;
  excerptStart: number | null;
  excerptEnd: number | null;
  userAdded: boolean;
  sortOrder: number;
}

/**
 * A citation that has been checked against the source text. `verified` is
 * only ever set by lib/ai/citations.ts — never by the model, and never
 * trusted from model output.
 */
export interface Evidence {
  quote: string;
  locator: string;
  scopeItemId?: string;
  start: number;
  end: number;
  verified: boolean;
}

export interface Assessment {
  id: string;
  requestItemId: string;
  analysisRunId: string;
  proposedLabel: AssessmentLabel;
  explanation: string;
  supportingEvidence: Evidence[];
  conflictingEvidence: Evidence[];
  missingInformation: string[];
  suggestedQuestion: string | null;
  validationFailed: boolean;
  validationNotes: string | null;
  createdAt: string;
}

export interface ItemReview {
  id: string;
  requestItemId: string;
  reviewedAssessmentId: string | null;
  finalLabel: AssessmentLabel;
  note: string | null;
  /** The decision rests on context outside the document. */
  userContextBased: boolean;
  reviewedAt: string;
}

export interface AnalysisRun {
  id: string;
  changeRequestId: string;
  operation: AiOperation;
  status: AnalysisStatus;
  model: string;
  promptVersion: string;
  inputHash: string;
  fixtureMode: boolean;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface EstimateItem {
  id: string;
  changeRequestId: string;
  requestItemId: string | null;
  description: string;
  /** Null until a human enters it. The model never fills this in. */
  hours: string | null;
  rate: string | null;
  lineTotal: string;
  aiSuggested: boolean;
  sortOrder: number;
}

/**
 * The model's rough reference figure for an estimate line (§8 "AI-generated
 * hours", honest version). It is DISPLAY-ONLY: estimate_items.hours stays
 * null until the user types their own figure, and computeTotals never reads
 * this record. The UI must always label it as a reference draft.
 */
export interface HourSuggestion {
  id: string;
  estimateItemId: string;
  draftHours: string;
  rationale: string;
  createdAt: string;
}

/**
 * A contract-adjacent topic the model flagged for professional review.
 * Internal only — never rendered into an export — and phrased as a topic
 * pointer, never a legal conclusion (no breach/liability/enforceability).
 */
export interface LegalFlag {
  id: string;
  requestItemId: string;
  topic: string;
  note: string;
  createdAt: string;
}

export interface DocumentVersion {
  id: string;
  changeRequestId: string;
  kind: DocumentKind;
  version: number;
  tone: Tone | null;
  sections: Record<string, string>;
  userEdited: boolean;
  finalizedAt: string | null;
  snapshot: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface StatusEvent {
  id: string;
  changeRequestId: string | null;
  projectId: string;
  event: string;
  actor: "user" | "system";
  note: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** A request item joined with its latest model output and human decision. */
export interface ReviewableItem {
  item: RequestItem;
  assessment: Assessment | null;
  review: ItemReview | null;
}
