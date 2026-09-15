"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { analyzeRequest } from "@/lib/ai/analyze-request";
import { flagLegalTopics } from "@/lib/ai/legal-flags";
import { isFixtureMode, ModelOutputError, modelFor } from "@/lib/ai/provider";
import { PROMPT_VERSIONS } from "@/lib/ai/prompts";
import { requireUser } from "@/lib/auth";
import {
  getConfirmedVersion,
  getProject,
  getScopeDocument,
  getScopeVersion,
  listScopeItems,
} from "@/lib/data/projects";
import {
  addRequestItem,
  createChangeRequest,
  deleteRequestItem,
  failAnalysisRun,
  getChangeRequest,
  getReviewableItems,
  inputHash,
  listLegalFlags,
  recordEvent,
  replaceLegalFlags,
  saveAnalysis,
  saveReview,
  setUserContext,
  startAnalysisRun,
  updateRequestItem,
} from "@/lib/data/requests";
import { messageFor, type FormState } from "@/lib/forms";
import { ASSESSMENT_LABELS, type AssessmentLabel } from "@/lib/types";

/**
 * Capture a client message and immediately analyse it.
 *
 * The change request row is written BEFORE the model runs, so a failed
 * analysis leaves a retryable record rather than losing the pasted message
 * (plan §11).
 */
export async function createRequestAction(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const title = String(formData.get("title") ?? "").trim();
  const clientMessage = String(formData.get("clientMessage") ?? "");
  const receivedOn = String(formData.get("receivedOn") ?? "").trim() || null;
  const sourceLabel = String(formData.get("sourceLabel") ?? "").trim() || null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  if (title.length === 0) fieldErrors.title = "Give this request a short title.";
  if (clientMessage.trim().length === 0) {
    fieldErrors.clientMessage = "Paste the message your client sent.";
  }
  if (!idempotencyKey) {
    return { error: "This form has expired. Please reload the page and try again." };
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  let requestId: string;

  try {
    // The project read is the ownership check — members cannot capture requests.
    await getProject(user.id, projectId);

    const baseline = await getConfirmedVersion(user.id, projectId);
    if (!baseline) {
      return {
        error: "Confirm a scope baseline before analysing client requests.",
      };
    }

    const request = await createChangeRequest(user.id, {
      projectId,
      scopeVersionId: baseline.id,
      title,
      clientMessage,
      receivedOn,
      sourceLabel: sourceLabel as never,
      idempotencyKey,
    });

    requestId = request.id;

    await recordEvent(user.id, {
      projectId,
      changeRequestId: request.id,
      event: "Request captured",
      note: `${request.reference} created against baseline version ${baseline.version}.`,
    });
  } catch (error) {
    return { error: messageFor(error) };
  }

  // Analysis failure is not fatal: the request exists and the review screen
  // offers a retry.
  await runAnalysis(user.id, projectId, requestId);

  revalidatePath(`/projects/${projectId}`, "layout");
  redirect(`/projects/${projectId}/requests/${requestId}`);
}

/**
 * Run (or re-run) the comparison.
 *
 * Never throws: a failed run is recorded on analysis_runs and surfaced in the
 * UI as a retryable processing state, kept separate from business status.
 */
export async function runAnalysis(
  userId: string,
  projectId: string,
  requestId: string,
): Promise<void> {
  const request = await getChangeRequest(userId, requestId);
  const version = await getScopeVersion(userId, request.scopeVersionId);
  const document = await getScopeDocument(userId, version.documentId);
  const scopeItems = await listScopeItems(userId, version.id);

  const promptVersion = PROMPT_VERSIONS.analyze_request;
  const fixture = isFixtureMode();

  const run = await startAnalysisRun(userId, requestId, {
    model: fixture ? "fixture" : modelFor("analyze"),
    promptVersion,
    inputHash: inputHash({
      clientMessage: request.clientMessage,
      scopeVersionId: version.id,
      userContext: request.userContext,
      promptVersion,
    }),
    fixtureMode: fixture,
  });

  try {
    const analysis = await analyzeRequest({
      clientMessage: request.clientMessage,
      documentText: document.extractedText,
      locators: document.locators,
      scopeItems,
      userContext: request.userContext,
    });

    await saveAnalysis(userId, requestId, run.id, analysis.items, {
      inputTokens: analysis.usage.inputTokens,
      outputTokens: analysis.usage.outputTokens,
      costUsd: analysis.usage.costUsd,
      durationMs: analysis.usage.durationMs,
      attempts: analysis.usage.attempts,
    });

    await recordEvent(userId, {
      projectId,
      changeRequestId: requestId,
      event: "Analysis completed",
      actor: "system",
      note: `${analysis.items.length} item${analysis.items.length === 1 ? "" : "s"} assessed.`,
    });
  } catch (error) {
    const invalid = error instanceof ModelOutputError;

    await failAnalysisRun(
      userId,
      run.id,
      messageFor(error),
      invalid ? "invalid_output" : "failed",
    );

    await recordEvent(userId, {
      projectId,
      changeRequestId: requestId,
      event: "Analysis failed",
      actor: "system",
      note: invalid
        ? "The model's output could not be validated. No unverified results were saved."
        : "The analysis could not be completed. Your request text is unchanged.",
    });
  }
}

export async function reanalyzeAction(
  projectId: string,
  requestId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    // Owner-only: re-analysis writes new model output.
    await getProject(user.id, projectId);
    await runAnalysis(user.id, projectId, requestId);
    revalidatePath(`/projects/${projectId}/requests/${requestId}`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/**
 * Flag contract-adjacent topics for professional review (§8 "automatic legal
 * conclusions", honest version).
 *
 * Opt-in, and the output is a TOPIC POINTER stored in ai_legal_flags —
 * internal only, never rendered into a reply, change order, or export. Notes
 * containing legal-conclusion language are rejected by validation and dropped
 * if the retry still produces them (see lib/ai/legal-flags.ts). The user is
 * told when a flag was dropped, never shown the conclusion itself.
 */
export async function flagLegalTopicsAction(
  projectId: string,
  requestId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    // The project read is the ownership check.
    await getProject(user.id, projectId);
    const entries = await getReviewableItems(user.id, requestId);

    if (entries.length === 0) {
      return { error: "There are no items to flag yet." };
    }

    const result = await flagLegalTopics({
      items: entries.map((entry) => ({
        title: entry.item.title,
        description: entry.item.description,
      })),
    });

    const byTitle = new Map(entries.map((entry) => [entry.item.title, entry.item.id]));

    const matched = result.flags.flatMap((flag) => {
      const requestItemId = byTitle.get(flag.requestItemTitle);
      if (!requestItemId) return [];
      return [{ requestItemId, topic: flag.topic, note: flag.note }];
    });

    await replaceLegalFlags(user.id, requestId, matched);

    revalidatePath(`/projects/${projectId}/requests/${requestId}`);
    return result.warnings.length > 0
      ? { error: result.warnings.join(" ") }
      : { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/**
 * Record additional context and re-run.
 *
 * The context is stored on the change request as USER-PROVIDED, and the
 * prompt tells the model not to quote it as scope evidence — it informs the
 * judgement without becoming a citation.
 */
export async function addContextAction(
  projectId: string,
  requestId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const context = String(formData.get("context") ?? "").trim();

  if (context.length === 0) return { error: "Add the context you want to supply." };

  try {
    // Owner-only: the context re-runs the analysis on the owner's behalf.
    await getProject(user.id, projectId);
    await setUserContext(user.id, requestId, context);
    await recordEvent(user.id, {
      projectId,
      changeRequestId: requestId,
      event: "Context added",
      note: context.slice(0, 200),
    });

    await runAnalysis(user.id, projectId, requestId);
    revalidatePath(`/projects/${projectId}/requests/${requestId}`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/** Record the user's decision on one item. */
export async function reviewItemAction(
  projectId: string,
  requestId: string,
  input: {
    requestItemId: string;
    assessmentId: string | null;
    finalLabel: string;
    note: string | null;
    userContextBased: boolean;
  },
): Promise<FormState> {
  const user = await requireUser();

  if (!ASSESSMENT_LABELS.includes(input.finalLabel as AssessmentLabel)) {
    return { error: "That is not a valid assessment." };
  }

  try {
    // Owner-only: reviews are the owner's decisions on their records.
    await getProject(user.id, projectId);
    await saveReview(user.id, {
      requestItemId: input.requestItemId,
      assessmentId: input.assessmentId,
      finalLabel: input.finalLabel as AssessmentLabel,
      note: input.note,
      userContextBased: input.userContextBased,
    });

    await recordEvent(user.id, {
      projectId,
      changeRequestId: requestId,
      event: "Item reviewed",
      note: input.note ? input.note.slice(0, 200) : null,
      metadata: { finalLabel: input.finalLabel },
    });

    revalidatePath(`/projects/${projectId}/requests/${requestId}`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function updateItemAction(
  projectId: string,
  requestId: string,
  itemId: string,
  input: { title: string; description: string },
): Promise<FormState> {
  const user = await requireUser();

  try {
    await getProject(user.id, projectId);
    await updateRequestItem(user.id, itemId, input);
    revalidatePath(`/projects/${projectId}/requests/${requestId}`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function deleteItemAction(
  projectId: string,
  requestId: string,
  itemId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    await getProject(user.id, projectId);
    await deleteRequestItem(user.id, itemId);
    revalidatePath(`/projects/${projectId}/requests/${requestId}`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function addItemAction(
  projectId: string,
  requestId: string,
  input: { title: string; sourceExcerpt: string },
): Promise<FormState> {
  const user = await requireUser();

  if (input.title.trim().length === 0) return { error: "Give the item a title." };

  try {
    await getProject(user.id, projectId);
    await addRequestItem(user.id, requestId, {
      title: input.title.trim(),
      description: "",
      sourceExcerpt: input.sourceExcerpt.trim() || input.title.trim(),
    });

    revalidatePath(`/projects/${projectId}/requests/${requestId}`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/** Re-exported for pages that need to show which model will be used. */
export async function getModelLabel(): Promise<string> {
  return isFixtureMode() ? "fixture mode" : modelFor("analyze");
}

export async function getProjectName(projectId: string): Promise<string> {
  const user = await requireUser();
  const project = await getProject(user.id, projectId);
  return project.name;
}
