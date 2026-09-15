/**
 * Change request, analysis, review, estimate and document queries.
 *
 * The separation the plan insists on (§4) is load-bearing here:
 *
 *   assessments   — what the model proposed, append-only
 *   item_reviews  — what the user decided, one row per item
 *   document_versions — what was drafted, frozen once finalized
 *
 * `saveAnalysis` writes new assessments WITHOUT touching item_reviews, which
 * is why re-running analysis cannot silently discard reviewed work. The UI
 * surfaces the mismatch instead (see `isReviewStale`).
 *
 * Reads are visibility-scoped by RLS (owner OR project member, migration
 * 0005); writes keep their owner_id filters, and migration 0006 makes
 * "working rows carry the project owner's id" a database invariant.
 */

import "server-only";

import { createHash } from "node:crypto";

import { NotFoundError } from "@/lib/auth";
import type { AnalyzedItem } from "@/lib/ai/analyze-request";
import { createClient } from "@/lib/supabase/server";
import type {
  AnalysisRun,
  Assessment,
  AssessmentLabel,
  ChangeRequest,
  DocumentKind,
  DocumentVersion,
  EstimateItem,
  HourSuggestion,
  ItemReview,
  LegalFlag,
  RequestItem,
  RequestStatus,
  ReviewableItem,
  StatusEvent,
  Tone,
} from "@/lib/types";

import { CLIENT_MESSAGE_LIMIT } from "@/lib/limits";

import {
  toAnalysisRun,
  toAssessment,
  toChangeRequest,
  toDocumentVersion,
  toEstimateItem,
  toHourSuggestion,
  toItemReview,
  toLegalFlag,
  toRequestItem,
  toStatusEvent,
} from "./mappers";



// ── Change requests ─────────────────────────────────────────────────────────

export async function listChangeRequests(
  userId: string,
  projectId: string,
): Promise<ChangeRequest[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("change_requests")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toChangeRequest);
}

export async function getChangeRequest(
  userId: string,
  requestId: string,
): Promise<ChangeRequest> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("change_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("change request");

  return toChangeRequest(data);
}

export interface CreateChangeRequestInput {
  projectId: string;
  scopeVersionId: string;
  title: string;
  clientMessage: string;
  receivedOn: string | null;
  sourceLabel: ChangeRequest["sourceLabel"];
  /** Rendered into the form so a double submit collides instead of duplicating. */
  idempotencyKey: string;
}

export async function createChangeRequest(
  userId: string,
  input: CreateChangeRequestInput,
): Promise<ChangeRequest> {
  if (input.clientMessage.trim().length === 0) {
    throw new Error("Paste the client's message to continue.");
  }

  if (input.clientMessage.length > CLIENT_MESSAGE_LIMIT) {
    throw new Error(
      `This message is over the ${CLIENT_MESSAGE_LIMIT.toLocaleString()} character limit. Paste the part containing the request.`,
    );
  }

  const supabase = await createClient();

  // A repeated submission lands on the unique index and returns the record
  // that already exists, so the user gets their request rather than an error.
  const existing = await supabase
    .from("change_requests")
    .select("*")
    .eq("owner_id", userId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (existing.data) return toChangeRequest(existing.data);

  const reference = await nextReference(userId, input.projectId);

  const { data, error } = await supabase
    .from("change_requests")
    .insert({
      project_id: input.projectId,
      owner_id: userId,
      scope_version_id: input.scopeVersionId,
      reference,
      idempotency_key: input.idempotencyKey,
      title: input.title,
      client_message: input.clientMessage,
      received_on: input.receivedOn,
      source_label: input.sourceLabel,
      status: "draft",
    })
    .select()
    .single();

  if (error) {
    // Lost the race with a concurrent identical submit — return the winner.
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("change_requests")
        .select("*")
        .eq("owner_id", userId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (raced) return toChangeRequest(raced);
    }
    throw error;
  }

  return toChangeRequest(data);
}

async function nextReference(userId: string, projectId: string): Promise<string> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("change_requests")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("owner_id", userId);

  if (error) throw error;
  return `CR-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

export async function updateRequestStatus(
  userId: string,
  requestId: string,
  status: RequestStatus,
  extra: { sentAt?: string | null; decidedAt?: string | null } = {},
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("change_requests")
    .update({
      status,
      ...(extra.sentAt !== undefined && { sent_at: extra.sentAt }),
      ...(extra.decidedAt !== undefined && { decided_at: extra.decidedAt }),
    })
    .eq("id", requestId)
    .eq("owner_id", userId);

  if (error) throw error;
}

export async function setUserContext(
  userId: string,
  requestId: string,
  context: string | null,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("change_requests")
    .update({ user_context: context })
    .eq("id", requestId)
    .eq("owner_id", userId);

  if (error) throw error;
}

/**
 * Set (or clear) the tax line on a change request.
 *
 * The rate and label are USER input, stored verbatim after decimal-safe
 * parsing. Amounts are never stored — they are computed by computeTotals at
 * every read, so a rate change cannot leave a stale figure behind.
 */
export async function setTax(
  userId: string,
  requestId: string,
  input: { label: string | null; rate: string | null },
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("change_requests")
    .update({ tax_label: input.label, tax_rate: input.rate })
    .eq("id", requestId)
    .eq("owner_id", userId);

  if (error) throw error;
}

// ── Request items, assessments and reviews ──────────────────────────────────

export async function listRequestItems(
  userId: string,
  requestId: string,
): Promise<RequestItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("request_items")
    .select("*")
    .eq("change_request_id", requestId)
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map(toRequestItem);
}

/** Hash of the inputs an analysis depended on, for staleness detection. */
export function inputHash(parts: {
  clientMessage: string;
  scopeVersionId: string;
  userContext: string | null;
  promptVersion: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        parts.clientMessage,
        parts.scopeVersionId,
        parts.userContext ?? "",
        parts.promptVersion,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

export async function startAnalysisRun(
  userId: string,
  requestId: string,
  meta: { model: string; promptVersion: string; inputHash: string; fixtureMode: boolean },
): Promise<AnalysisRun> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("analysis_runs")
    .insert({
      change_request_id: requestId,
      owner_id: userId,
      operation: "analyze_request",
      status: "running",
      model: meta.model,
      prompt_version: meta.promptVersion,
      input_hash: meta.inputHash,
      fixture_mode: meta.fixtureMode,
    })
    .select()
    .single();

  if (error) throw error;
  return toAnalysisRun(data);
}

export async function failAnalysisRun(
  userId: string,
  runId: string,
  message: string,
  status: "failed" | "invalid_output" = "failed",
): Promise<void> {
  const supabase = await createClient();

  await supabase
    .from("analysis_runs")
    .update({
      status,
      // Truncated and generic: never let document text reach a log or an
      // error column (plan §11).
      error_message: message.slice(0, 500),
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("owner_id", userId);
}

/**
 * Record that a run's result came from the deterministic fallback rather
 * than the live model — used by the sample seed when live output fails
 * citation verification. The run row is created before the model call, so
 * this corrects the model/fixture columns after the fact. Honesty about
 * the source of an assessment outranks the nicer story.
 */
export async function markAnalysisRunFixture(
  userId: string,
  runId: string,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("analysis_runs")
    .update({ model: "fixture", fixture_mode: true })
    .eq("id", runId)
    .eq("owner_id", userId);

  if (error) throw error;
}

/**
 * Persist a completed analysis.
 *
 * Deliberately does NOT touch item_reviews. Re-analysis produces new
 * assessments; the user's prior decisions survive and the review screen marks
 * them stale so the user reconciles them explicitly (plan §7).
 */
export async function saveAnalysis(
  userId: string,
  requestId: string,
  runId: string,
  items: AnalyzedItem[],
  usage: Record<string, unknown>,
): Promise<void> {
  const supabase = await createClient();

  const existing = await listRequestItems(userId, requestId);
  const existingByExcerpt = new Map(existing.map((item) => [item.sourceExcerpt, item]));

  for (const [index, analyzed] of items.entries()) {
    let requestItem = existingByExcerpt.get(analyzed.sourceExcerpt);

    if (!requestItem) {
      const { data, error } = await supabase
        .from("request_items")
        .insert({
          change_request_id: requestId,
          owner_id: userId,
          title: analyzed.title,
          description: analyzed.description,
          source_excerpt: analyzed.sourceExcerpt,
          excerpt_start: analyzed.excerptStart,
          excerpt_end: analyzed.excerptEnd,
          sort_order: index,
        })
        .select()
        .single();

      if (error) throw error;
      requestItem = toRequestItem(data);
    }

    const { error: assessmentError } = await supabase.from("assessments").insert({
      request_item_id: requestItem.id,
      analysis_run_id: runId,
      owner_id: userId,
      proposed_label: analyzed.proposedLabel,
      explanation: analyzed.explanation,
      supporting_evidence: analyzed.supportingEvidence,
      conflicting_evidence: analyzed.conflictingEvidence,
      missing_information: analyzed.missingInformation,
      suggested_question: analyzed.suggestedQuestion,
      validation_failed: analyzed.validationFailed,
      validation_notes: analyzed.validationNotes,
    });

    if (assessmentError) throw assessmentError;
  }

  const { error } = await supabase
    .from("analysis_runs")
    .update({ status: "succeeded", finished_at: new Date().toISOString(), usage })
    .eq("id", runId)
    .eq("owner_id", userId);

  if (error) throw error;
}

export async function getLatestRun(
  userId: string,
  requestId: string,
): Promise<AnalysisRun | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("change_request_id", requestId)
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] ? toAnalysisRun(data[0]) : null;
}

/**
 * Items with their latest assessment and the user's review.
 *
 * The three records stay distinct in the returned shape so the UI can show
 * "the model said X, you decided Y" rather than collapsing them into one
 * ambiguous value.
 */
export async function getReviewableItems(
  userId: string,
  requestId: string,
): Promise<ReviewableItem[]> {
  const supabase = await createClient();
  const items = await listRequestItems(userId, requestId);
  if (items.length === 0) return [];

  const ids = items.map((item) => item.id);

  const [assessmentResult, reviewResult] = await Promise.all([
    supabase
      .from("assessments")
      .select("*")
      .in("request_item_id", ids)
      .order("created_at", { ascending: false }),
    supabase.from("item_reviews").select("*").in("request_item_id", ids),
  ]);

  if (assessmentResult.error) throw assessmentResult.error;
  if (reviewResult.error) throw reviewResult.error;

  const latestAssessment = new Map<string, Assessment>();
  for (const row of assessmentResult.data ?? []) {
    const assessment = toAssessment(row);
    // Ordered newest first, so the first one wins.
    if (!latestAssessment.has(assessment.requestItemId)) {
      latestAssessment.set(assessment.requestItemId, assessment);
    }
  }

  const reviews = new Map<string, ItemReview>(
    (reviewResult.data ?? []).map((row) => {
      const review = toItemReview(row);
      return [review.requestItemId, review];
    }),
  );

  return items.map((item) => ({
    item,
    assessment: latestAssessment.get(item.id) ?? null,
    review: reviews.get(item.id) ?? null,
  }));
}

/**
 * True when the user reviewed an older assessment than the current one — a
 * re-analysis happened after their decision. The UI asks them to reconcile
 * rather than quietly presenting either version as current.
 */
export function isReviewStale(entry: ReviewableItem): boolean {
  if (!entry.review || !entry.assessment) return false;
  return entry.review.reviewedAssessmentId !== entry.assessment.id;
}

export async function saveReview(
  userId: string,
  input: {
    requestItemId: string;
    assessmentId: string | null;
    finalLabel: AssessmentLabel;
    note: string | null;
    userContextBased: boolean;
  },
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("item_reviews").upsert(
    {
      request_item_id: input.requestItemId,
      owner_id: userId,
      reviewed_assessment_id: input.assessmentId,
      final_label: input.finalLabel,
      note: input.note,
      user_context_based: input.userContextBased,
      reviewed_at: new Date().toISOString(),
    },
    { onConflict: "request_item_id" },
  );

  if (error) throw error;
}

export async function updateRequestItem(
  userId: string,
  itemId: string,
  input: { title?: string; description?: string },
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("request_items")
    .update({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
    })
    .eq("id", itemId)
    .eq("owner_id", userId);

  if (error) throw error;
}

export async function deleteRequestItem(userId: string, itemId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("request_items")
    .delete()
    .eq("id", itemId)
    .eq("owner_id", userId);

  if (error) throw error;
}

export async function addRequestItem(
  userId: string,
  requestId: string,
  input: { title: string; description: string; sourceExcerpt: string },
): Promise<RequestItem> {
  const supabase = await createClient();
  const existing = await listRequestItems(userId, requestId);

  const { data, error } = await supabase
    .from("request_items")
    .insert({
      change_request_id: requestId,
      owner_id: userId,
      title: input.title,
      description: input.description,
      source_excerpt: input.sourceExcerpt,
      user_added: true,
      sort_order: existing.length,
    })
    .select()
    .single();

  if (error) throw error;
  return toRequestItem(data);
}

// ── Estimates ───────────────────────────────────────────────────────────────

export async function listEstimateItems(
  userId: string,
  requestId: string,
): Promise<EstimateItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("change_request_id", requestId)
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map(toEstimateItem);
}

export async function addEstimateItem(
  userId: string,
  requestId: string,
  input: {
    description: string;
    requestItemId: string | null;
    hours: string | null;
    rate: string | null;
    aiSuggested?: boolean;
  },
): Promise<EstimateItem> {
  const supabase = await createClient();
  const existing = await listEstimateItems(userId, requestId);

  const { data, error } = await supabase
    .from("estimate_items")
    .insert({
      change_request_id: requestId,
      owner_id: userId,
      request_item_id: input.requestItemId,
      description: input.description,
      hours: input.hours,
      rate: input.rate,
      ai_suggested: input.aiSuggested ?? false,
      sort_order: existing.length,
    })
    .select()
    .single();

  if (error) throw error;
  return toEstimateItem(data);
}

export async function updateEstimateItem(
  userId: string,
  itemId: string,
  input: { description?: string; hours?: string | null; rate?: string | null },
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("estimate_items")
    .update({
      ...(input.description !== undefined && { description: input.description }),
      ...(input.hours !== undefined && { hours: input.hours }),
      ...(input.rate !== undefined && { rate: input.rate }),
    })
    .eq("id", itemId)
    .eq("owner_id", userId);

  if (error) throw error;
}

export async function deleteEstimateItem(userId: string, itemId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("estimate_items")
    .delete()
    .eq("id", itemId)
    .eq("owner_id", userId);

  if (error) throw error;
}

// ── AI draft suggestions (display-only; see migration 0004) ─────────────────

/**
 * Reference hour drafts for a change request's estimate lines.
 *
 * These are the model's rough figures, shown next to the (empty) hours input.
 * They are never summed, never exported, and never written into
 * estimate_items.hours — that column is filled only by the user typing.
 */
export async function listHourSuggestions(
  userId: string,
  requestId: string,
): Promise<HourSuggestion[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_hour_suggestions")
    .select("*, estimate_items!inner(change_request_id)")
    .eq("estimate_items.change_request_id", requestId)
    .eq("owner_id", userId);

  // `*` carries the suggestion's own columns; the inner join only filters.
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => toHourSuggestion(row));
}

/**
 * Replace the hour suggestions for a set of estimate lines.
 *
 * Fresh-per-run rather than append: a stale suggestion lingering beside a
 * changed description would be misleading, and there is no reviewed history
 * to preserve — unlike assessments, nothing downstream depends on these.
 */
export async function replaceHourSuggestions(
  userId: string,
  input: Array<{ estimateItemId: string; draftHours: string; rationale: string }>,
): Promise<void> {
  const supabase = await createClient();

  if (input.length === 0) return;

  const ids = input.map((item) => item.estimateItemId);
  await supabase.from("ai_hour_suggestions").delete().in("estimate_item_id", ids);

  const { error } = await supabase.from("ai_hour_suggestions").insert(
    input.map((item) => ({
      estimate_item_id: item.estimateItemId,
      owner_id: userId,
      draft_hours: item.draftHours,
      rationale: item.rationale,
    })),
  );

  if (error) throw error;
}

/** Legal topic flags for a change request's items. Internal use only. */
export async function listLegalFlags(
  userId: string,
  requestId: string,
): Promise<LegalFlag[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_legal_flags")
    .select("*, request_items!inner(change_request_id)")
    .eq("request_items.change_request_id", requestId)
    .eq("owner_id", userId);

  // `*` carries the flag's own columns; the inner join only filters.
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => toLegalFlag(row));
}

/**
 * Replace the legal flags for a change request. Upsert semantics per
 * (request_item_id, topic) would accumulate across runs; a clean replace
 * keeps the panel in step with what the model last said.
 */
export async function replaceLegalFlags(
  userId: string,
  requestId: string,
  input: Array<{ requestItemId: string; topic: string; note: string }>,
): Promise<void> {
  const supabase = await createClient();

  // Scope the delete to this request's items, not the whole table.
  const { data: itemIds } = await supabase
    .from("request_items")
    .select("id")
    .eq("change_request_id", requestId)
    .eq("owner_id", userId);

  if (itemIds && itemIds.length > 0) {
    await supabase
      .from("ai_legal_flags")
      .delete()
      .in(
        "request_item_id",
        itemIds.map((row: { id: string }) => row.id),
      );
  }

  if (input.length === 0) return;

  const { error } = await supabase.from("ai_legal_flags").insert(
    input.map((item) => ({
      request_item_id: item.requestItemId,
      owner_id: userId,
      topic: item.topic,
      note: item.note,
    })),
  );

  if (error) throw error;
}

// ── Documents ───────────────────────────────────────────────────────────────

export async function getLatestDocument(
  userId: string,
  requestId: string,
  kind: DocumentKind,
): Promise<DocumentVersion | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("document_versions")
    .select("*")
    .eq("change_request_id", requestId)
    .eq("kind", kind)
    .order("version", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] ? toDocumentVersion(data[0]) : null;
}

export async function createDocumentVersion(
  userId: string,
  requestId: string,
  input: { kind: DocumentKind; tone: Tone; sections: Record<string, string> },
): Promise<DocumentVersion> {
  const supabase = await createClient();
  const latest = await getLatestDocument(userId, requestId, input.kind);

  const { data, error } = await supabase
    .from("document_versions")
    .insert({
      change_request_id: requestId,
      owner_id: userId,
      kind: input.kind,
      version: (latest?.version ?? 0) + 1,
      tone: input.tone,
      sections: input.sections,
    })
    .select()
    .single();

  if (error) throw error;
  return toDocumentVersion(data);
}

export async function updateDocumentSections(
  userId: string,
  documentId: string,
  sections: Record<string, string>,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("document_versions")
    .update({ sections, user_edited: true })
    .eq("id", documentId)
    .eq("owner_id", userId);

  if (error) throw error;
}

/** Freeze a document with its fully rendered snapshot. Immutable afterwards. */
export async function finalizeDocument(
  userId: string,
  documentId: string,
  snapshot: unknown,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("document_versions")
    .update({ finalized_at: new Date().toISOString(), snapshot })
    .eq("id", documentId)
    .eq("owner_id", userId);

  if (error) throw error;
}

// ── History ─────────────────────────────────────────────────────────────────

export async function recordEvent(
  userId: string,
  input: {
    projectId: string;
    changeRequestId?: string | null;
    event: string;
    actor?: "user" | "system";
    note?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const supabase = await createClient();

  await supabase.from("status_events").insert({
    project_id: input.projectId,
    change_request_id: input.changeRequestId ?? null,
    owner_id: userId,
    event: input.event,
    actor: input.actor ?? "user",
    note: input.note ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function listEvents(
  userId: string,
  requestId: string,
): Promise<StatusEvent[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("status_events")
    .select("*")
    .eq("change_request_id", requestId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toStatusEvent);
}
