import Link from "next/link";
import { redirect } from "next/navigation";

import { ButtonLink, FixtureBanner, LabelBadge, Notice, PageHeader } from "@/components/ui";
import { isFixtureMode } from "@/lib/ai/provider";
import { NotFoundError, requireUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/data/members";
import { getScopeDocument, getScopeVersion } from "@/lib/data/projects";
import {
  getChangeRequest,
  getLatestRun,
  getReviewableItems,
  isReviewStale,
  listLegalFlags,
} from "@/lib/data/requests";
import { checkFinalization, finalLabel, formatDate } from "@/lib/documents/render";

import { ReviewWorkspace } from "./review-workspace";

export const metadata = { title: "Assessment review" };

export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; requestId: string }>;
  searchParams: Promise<{ sample?: string; r?: string }>;
}) {
  const { id, requestId } = await params;
  const { sample, r } = await searchParams;

  const user = await requireUser(`/projects/${id}/requests/${requestId}`);

  let workspace;
  try {
    workspace = await loadWorkspace(user.id, id, requestId);
  } catch (error) {
    // A sample URL that 404s means the browser followed the demo handoff with
    // a stale session cookie, so we authenticated as someone other than the
    // user seedSample wrote as. Bounce through /demo/start once — by then the
    // cookie jar has settled, so the re-seed and this page agree on the user.
    if (error instanceof NotFoundError && sample === "1" && r !== "1") {
      redirect("/demo/start?r=1");
    }
    throw error;
  }

  const { project, request, version, document, entries, run, canEdit } = workspace;
  const legalFlags = await listLegalFlags(user.id, requestId);

  const staleIds = entries.filter(isReviewStale).map((entry) => entry.item.id);
  const check = checkFinalization(entries, []);
  const counts = countLabels(entries);

  return (
    <>
      {sample === "1" ? (
        <Notice tone="warning" className="mb-4" title="Sample data">
          <p>
            This is a fictional project created for you to explore. Everything works — edit
            the assessments, enter estimates, generate the documents. Your session is private
            and nothing here is real client data.
          </p>
        </Notice>
      ) : null}

      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={`/projects/${id}`} className="hover:text-foreground">
              {project.name}
            </Link>
            <span aria-hidden>·</span>
            <span>{request.reference}</span>
          </span>
        }
        title={request.title}
        description={
          <>
            Assessed against baseline version {version.version}
            {version.confirmedAt ? `, confirmed ${formatDate(version.confirmedAt)}` : ""}.
            {request.receivedOn ? ` Received ${formatDate(request.receivedOn)}.` : ""}
          </>
        }
        actions={
          <ButtonLink
            href={`/projects/${id}/requests/${requestId}/estimate`}
            variant="primary"
          >
            Continue to estimate
          </ButtonLink>
        }
      />

      {isFixtureMode() ? (
        <div className="mb-4">
          <FixtureBanner />
        </div>
      ) : null}

      {!canEdit ? (
        <Notice tone="info" className="mb-4" title="Read-only — you are a teammate on this project">
          <p>
            Assessments and evidence are open to review. Recording decisions on request items is
            the project owner&rsquo;s to do.
          </p>
        </Notice>
      ) : null}

      {/*
        Processing state is shown separately from business status, so a failed
        run never reads as an outcome (plan §10).
      */}
      {run?.status === "failed" || run?.status === "invalid_output" ? (
        <Notice
          tone="danger"
          className="mb-4"
          title={
            run.status === "invalid_output"
              ? "The model's output could not be validated"
              : "The analysis did not complete"
          }
        >
          <p>
            {run.status === "invalid_output"
              ? "Rather than show unverified evidence, nothing was saved. Your request text is unchanged — use Re-analyse to try again."
              : "Your request text is unchanged. Use Re-analyse to try again."}
          </p>
          {run.errorMessage ? (
            <p className="mt-1 text-xs opacity-80">{run.errorMessage}</p>
          ) : null}
        </Notice>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {counts.included > 0 ? (
            <span className="flex items-center gap-1.5">
              <LabelBadge label="included" size="sm" />
              <span className="text-sm text-muted-foreground">{counts.included}</span>
            </span>
          ) : null}
          {counts.potentially_additional > 0 ? (
            <span className="flex items-center gap-1.5">
              <LabelBadge label="potentially_additional" size="sm" />
              <span className="text-sm text-muted-foreground">{counts.potentially_additional}</span>
            </span>
          ) : null}
          {counts.needs_clarification > 0 ? (
            <span className="flex items-center gap-1.5">
              <LabelBadge label="needs_clarification" size="sm" />
              <span className="text-sm text-muted-foreground">{counts.needs_clarification}</span>
            </span>
          ) : null}
        </div>

        {check.blockers.length > 0 ? (
          <p className="ml-auto text-xs text-muted-foreground">
            {check.blockers[0]}
          </p>
        ) : (
          <p className="ml-auto text-xs text-ok">All items reviewed.</p>
        )}
      </div>

      <ReviewWorkspace
        projectId={id}
        request={request}
        document={document}
        entries={entries}
        staleIds={staleIds}
        legalFlags={legalFlags}
        canEdit={canEdit}
      />
    </>
  );
}

function countLabels(entries: Awaited<ReturnType<typeof getReviewableItems>>) {
  const counts = { included: 0, potentially_additional: 0, needs_clarification: 0 };

  for (const entry of entries) {
    // Prefer the user's decision; fall back to the proposal for the summary.
    const label = finalLabel(entry) ?? entry.assessment?.proposedLabel;
    if (label) counts[label]++;
  }

  return counts;
}

/** Everything the review screen needs, fetched as one fallible unit. */
async function loadWorkspace(userId: string, projectId: string, requestId: string) {
  // RLS-scoped: the owner or any teammate can review this screen. getProjectAccess
  // throws NotFoundError for a project this user cannot see, preserving the
  // demo-handoff redirect in the page component.
  const access = await getProjectAccess(userId, projectId);
  // An existing project this user cannot see is indistinguishable from one
  // that does not exist.
  if (!access) throw new NotFoundError("project");

  const [project, request] = [access.project, await getChangeRequest(userId, requestId)];

  const version = await getScopeVersion(userId, request.scopeVersionId);
  const [document, entries, run] = await Promise.all([
    getScopeDocument(userId, version.documentId),
    getReviewableItems(userId, requestId),
    getLatestRun(userId, requestId),
  ]);

  return { project, request, version, document, entries, run, canEdit: access.role === "owner" };
}
