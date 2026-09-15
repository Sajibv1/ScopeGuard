"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { draftDocuments } from "@/lib/ai/draft-documents";
import { requireUser, NotFoundError } from "@/lib/auth";
import { sendGate } from "@/lib/approvals";
import { getProject, getScopeDocument, getScopeVersion, listScopeItems } from "@/lib/data/projects";
import { getProjectAccess, listApprovals, listRoster, recordApproval } from "@/lib/data/members";
import {
  createDocumentVersion,
  finalizeDocument,
  getChangeRequest,
  getLatestDocument,
  getReviewableItems,
  listEstimateItems,
  recordEvent,
  updateDocumentSections,
  updateRequestStatus,
} from "@/lib/data/requests";
import {
  checkFinalization,
  finalLabel,
  renderChangeOrder,
} from "@/lib/documents/render";
import { messageFor, type FormState } from "@/lib/forms";
import { changeOrderReadyText, notifySlack, slackEnvCredential } from "@/lib/integrations/slack";
import { getSlackCredential } from "@/lib/data/integrations";
import type { RequestStatus, Tone } from "@/lib/types";

export interface DraftState extends FormState {
  warnings?: string[];
}

/**
 * Generate (or regenerate) the narrative sections.
 *
 * Creates a NEW document version rather than overwriting: the plan requires
 * that regeneration never silently discards manual edits, and a new version
 * leaves the edited one intact and inspectable.
 */
export async function generateDocumentsAction(
  projectId: string,
  requestId: string,
  tone: Tone,
): Promise<DraftState> {
  const user = await requireUser();

  try {
    const [project, request, entries, estimateItems] = await Promise.all([
      getProject(user.id, projectId),
      getChangeRequest(user.id, requestId),
      getReviewableItems(user.id, requestId),
      listEstimateItems(user.id, requestId),
    ]);

    const check = checkFinalization(entries, estimateItems);

    // A draft may carry open questions, so generation is allowed even with
    // warnings. Only finalization is gated.
    const draft = await draftDocuments({
      projectName: project.name,
      clientName: project.clientName,
      tone,
      // The model writes from the USER's decisions, not its own proposals.
      items: entries
        .filter((entry) => entry.review !== null)
        .map((entry) => ({
          title: entry.item.title,
          label: entry.review!.finalLabel,
          question: entry.assessment?.suggestedQuestion ?? null,
        })),
      workDescriptions: estimateItems.map((item) => item.description),
      hasEstimate: estimateItems.some((item) => item.hours !== null),
    });

    await createDocumentVersion(user.id, requestId, {
      kind: "client_reply",
      tone,
      sections: draft.sections,
    });

    await recordEvent(user.id, {
      projectId,
      changeRequestId: requestId,
      event: "Documents drafted",
      actor: "system",
      note: `Tone: ${tone}.${draft.fixture ? " Fixture mode." : ""}`,
    });

    revalidatePath(`/projects/${projectId}/requests/${requestId}/documents`);

    return {
      ok: true,
      warnings: [...draft.warnings, ...check.warnings],
    };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function saveSectionsAction(
  projectId: string,
  requestId: string,
  documentId: string,
  sections: Record<string, string>,
): Promise<FormState> {
  const user = await requireUser();

  try {
    // Owner-only: section edits change what a finalized document would say.
    await getProject(user.id, projectId);
    await updateDocumentSections(user.id, documentId, sections);
    revalidatePath(`/projects/${projectId}/requests/${requestId}/documents`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/**
 * Freeze the document and mark the request ready.
 *
 * The snapshot captures the fully rendered document — narrative plus every
 * deterministic figure — so a sent document can be reproduced exactly even
 * after the draft is edited again (plan §10).
 */
export async function finalizeAction(
  projectId: string,
  requestId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    const [project, request, entries, estimateItems] = await Promise.all([
      getProject(user.id, projectId),
      getChangeRequest(user.id, requestId),
      getReviewableItems(user.id, requestId),
      listEstimateItems(user.id, requestId),
    ]);

    const check = checkFinalization(entries, estimateItems);
    if (!check.ready) {
      return { error: check.blockers.join(" ") };
    }

    const document = await getLatestDocument(user.id, requestId, "client_reply");
    if (!document) {
      return { error: "Generate the documents before finalizing." };
    }

    const version = await getScopeVersion(user.id, request.scopeVersionId);

    // The frozen snapshot must carry the baseline's provenance: a finalized
    // export renders from the snapshot, so the "machine-transcribed" label
    // has to be in it, not computed later.
    const scopeDocument = await getScopeDocument(user.id, version.documentId);
    const scopeItems = await listScopeItems(user.id, version.id);

    const snapshot = renderChangeOrder({
      project,
      request,
      scopeVersion: version,
      items: entries,
      estimateItems,
      document,
      sourceIsTranscribed: scopeDocument.ocrApplied,
      sourceIsTranscript: scopeDocument.transcriptApplied,
      baselineIncludesMemory: scopeItems.some((item) => item.provenance === "memory"),
    });

    await finalizeDocument(user.id, document.id, snapshot);
    await updateRequestStatus(user.id, requestId, "ready");

    await recordEvent(user.id, {
      projectId,
      changeRequestId: requestId,
      event: "Document finalized",
      note: `${request.reference} frozen as version ${document.version}.`,
    });

    // Team notification (§8 Slack integration): the USER'S OWN connection
    // first — their token, their channel — then, only if they have none, the
    // operator-wide env pair. A failed notification must never fail
    // finalization — it is reported in the event feed, not raised.
    const credential = await getSlackCredential(user.id);
    const envSlack = slackEnvCredential();
    const target =
      credential?.channel != null
        ? { token: credential.token, channel: credential.channel, own: true }
        : envSlack
          ? { token: envSlack.token, channel: envSlack.channel, own: false }
          : null;

    if (target) {
      const headerList = await headers();
      const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
      const proto =
        headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

      const notification = await notifySlack({
        token: target.token,
        channel: target.channel,
        text: changeOrderReadyText({
          projectName: project.name,
          reference: request.reference,
          documentsUrl: `${proto}://${host}/projects/${projectId}/requests/${requestId}/documents`,
        }),
      });

      if (notification.ok) {
        await recordEvent(user.id, {
          projectId,
          changeRequestId: requestId,
          event: "Team notified in Slack",
          note: `Change order ready for review in ${target.channel}${
            target.own ? " (your Slack connection)" : " (workspace default)"
          }.`,
        });
      } else if (notification.reason === "failed") {
        await recordEvent(user.id, {
          projectId,
          changeRequestId: requestId,
          event: "Slack notification failed",
          note: notification.message,
        });
      }
    }

    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/**
 * Record what happened after sending.
 *
 * An approval here is a record of what the USER was told, never a verified
 * signature — the note is required so the source of the approval is on file
 * (plan §10).
 */
export async function recordOutcomeAction(
  projectId: string,
  requestId: string,
  status: RequestStatus,
  note: string | null,
): Promise<FormState> {
  const user = await requireUser();

  if (status === "approved" && (!note || note.trim().length === 0)) {
    return { error: "Describe where the approval came from, e.g. “email from Dana, 12 March”." };
  }

  try {
    // The project read is the ownership check — status is the owner's to set.
    await getProject(user.id, projectId);
    const request = await getChangeRequest(user.id, requestId);

    // Separation of duties (§8 approval chain): with approver teammates on
    // the project, the change order cannot be SENT until one of them has
    // signed off. A solo project has no such teammates and sends as before.
    if (status === "sent" && request.status === "ready") {
      const [roster, approvals] = await Promise.all([
        listRoster(user.id, projectId),
        listApprovals(user.id, requestId),
      ]);
      const gate = sendGate(
        roster.filter((member) => !member.isOwner),
        approvals,
      );

      if (gate.required && !gate.satisfied) {
        return {
          error:
            "This project requires internal approval before sending: a teammate with the approver or admin role must sign off on the change order first.",
        };
      }
    }

    const now = new Date().toISOString();

    await updateRequestStatus(user.id, requestId, status, {
      ...(status === "sent" ? { sentAt: now } : {}),
      ...(status === "approved" || status === "declined" ? { decidedAt: now } : {}),
    });

    const labels: Record<string, string> = {
      sent: "Marked sent",
      approved: "Approval recorded by user",
      declined: "Decline recorded",
      draft: "Returned to draft",
      ready: "Marked ready",
    };

    await recordEvent(user.id, {
      projectId,
      changeRequestId: requestId,
      event: labels[status] ?? "Status changed",
      note: note?.trim() || null,
    });

    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/**
 * Record a teammate's internal sign-off on a change request (§8 approval
 * chain, honest version).
 *
 * This is the "second pair of eyes" gate: with approver teammates on the
 * project, the owner cannot send the change order until one of them approves
 * it here. The record is a human act by a named teammate — never a signature,
 * and never shown to the client; it is internal workflow state.
 *
 * "Request changes" returns the request to draft so the owner can revise;
 * revision clears prior sign-offs (database trigger), so the revised document
 * needs a fresh look.
 */
export async function recordInternalApprovalAction(
  projectId: string,
  requestId: string,
  decision: "approved" | "changes_requested",
  note: string | null,
): Promise<FormState> {
  const user = await requireUser();

  if (decision === "changes_requested" && (!note || note.trim().length === 0)) {
    return { error: "Say what needs to change so the preparer can act on it." };
  }

  try {
    const access = await getProjectAccess(user.id, projectId);
    if (!access) throw new NotFoundError("project");

    // The owner prepared the change order — they cannot be their own second
    // pair of eyes. Viewers have not been given the authority either. (Same
    // rule as lib/approvals.ts canApproveInternally; written out here so the
    // role narrows for the record below.)
    if (access.role !== "admin" && access.role !== "approver") {
      return {
        error:
          "Only teammates with the approver or admin role can record an internal approval. The project owner prepares the change order; a teammate signs off on it.",
      };
    }

    const request = await getChangeRequest(user.id, requestId);

    if (request.status !== "ready") {
      return {
        error:
          "Internal approvals are recorded on finalized change orders that are ready to send.",
      };
    }

    await recordApproval(user.id, {
      requestId,
      role: access.role,
      decision,
      note: note?.trim() || null,
    });

    if (decision === "changes_requested") {
      // Back to draft for revision. The trigger clears the sign-off rows;
      // this event is the durable record of what the reviewer asked for.
      await updateRequestStatus(user.id, requestId, "draft");
    }

    await recordEvent(user.id, {
      projectId,
      changeRequestId: requestId,
      event:
        decision === "approved"
          ? "Internally approved by teammate"
          : "Changes requested by teammate",
      note:
        (note?.trim() || null) ??
        (decision === "approved"
          ? `Recorded by a teammate with the ${access.role} role, before sending.`
          : null),
      metadata: { internalApproval: decision, approverRole: access.role },
    });

    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}
