import Link from "next/link";

import { InternalApprovalPanel } from "../../../internal-approval";
import { FixtureBanner, Notice, PageHeader } from "@/components/ui";
import { isFixtureMode } from "@/lib/ai/provider";
import { NotFoundError, requireUser } from "@/lib/auth";
import { sendGate } from "@/lib/approvals";
import { getProjectAccess, listApprovals, listRoster } from "@/lib/data/members";
import { getScopeDocument, getScopeVersion, listScopeItems } from "@/lib/data/projects";
import {
  getChangeRequest,
  getLatestDocument,
  getReviewableItems,
  listEstimateItems,
} from "@/lib/data/requests";
import {
  checkFinalization,
  renderChangeOrder,
  renderClientReply,
} from "@/lib/documents/render";

import { DocumentWorkspace } from "./document-workspace";

export const metadata = { title: "Documents" };

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  const user = await requireUser(`/projects/${id}/requests/${requestId}/documents`);

  const access = await getProjectAccess(user.id, id);
  // An existing project this user cannot see is indistinguishable from one
  // that does not exist.
  if (!access) throw new NotFoundError("project");

  const { project } = access;
  const request = await getChangeRequest(user.id, requestId);

  const [scopeVersion, entries, estimateItems, document] = await Promise.all([
    getScopeVersion(user.id, request.scopeVersionId),
    getReviewableItems(user.id, requestId),
    listEstimateItems(user.id, requestId),
    getLatestDocument(user.id, requestId, "client_reply"),
  ]);

  // The baseline's provenance follows it onto every document (plan §8 OCR
  // boundary: a transcription is labelled as one, exports included).
  const scopeDocument = await getScopeDocument(user.id, scopeVersion.documentId);
  const scopeItems = await listScopeItems(user.id, scopeVersion.id);

  // The send gate and prior sign-offs, so the owner sees what stands between
  // ready and sent, and approver teammates can sign off from this screen.
  const [roster, approvals] = await Promise.all([
    listRoster(user.id, id),
    listApprovals(user.id, requestId),
  ]);
  const gate = sendGate(
    roster.filter((member) => !member.isOwner),
    approvals,
  );

  const renderInput = {
    project,
    request,
    scopeVersion,
    items: entries,
    estimateItems,
    document,
    sourceIsTranscribed: scopeDocument.ocrApplied,
    sourceIsTranscript: scopeDocument.transcriptApplied,
    baselineIncludesMemory: scopeItems.some((item) => item.provenance === "memory"),
  };

  const rendered = renderChangeOrder(renderInput);
  const reply = renderClientReply(renderInput);
  const check = checkFinalization(entries, estimateItems);

  const isOwner = access.role === "owner";

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={`/projects/${id}`} className="hover:text-foreground">
              {project.name}
            </Link>
            <span aria-hidden>·</span>
            <Link
              href={`/projects/${id}/requests/${requestId}`}
              className="hover:text-foreground"
            >
              {request.reference}
            </Link>
          </span>
        }
        title="Reply and change order"
        description="Edit anything. Totals, dates and the estimate table come from your records and cannot be changed by editing the text."
      />

      {isFixtureMode() ? (
        <div className="mb-4">
          <FixtureBanner />
        </div>
      ) : null}

      {!isOwner ? (
        <Notice tone="info" className="mb-4" title="Read-only — you are a teammate on this project">
          <p>
            You can read the drafts and the rendered change order. Generating, editing and
            finalizing are the project owner&rsquo;s to do.
          </p>
        </Notice>
      ) : null}

      <DocumentWorkspace
        projectId={id}
        requestId={requestId}
        document={document}
        rendered={rendered}
        replyText={reply.body}
        blockers={check.blockers}
        warnings={check.warnings}
        requestApproved={request.status === "approved"}
        canEdit={isOwner}
      />

      {/*
        The approval panel appears once the owner has finalized the change
        order. Sign-offs are internal records — never rendered into any export.
      */}
      {request.status === "ready" ? (
        <div className="mt-4">
          <InternalApprovalPanel
            projectId={id}
            requestId={requestId}
            viewerRole={access.role}
            viewerId={user.id}
            gate={gate}
            approvals={approvals}
          />
        </div>
      ) : null}
    </>
  );
}
