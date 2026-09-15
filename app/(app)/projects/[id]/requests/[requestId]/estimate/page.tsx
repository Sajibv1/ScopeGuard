import Link from "next/link";

import { ButtonLink, Notice, PageHeader } from "@/components/ui";
import { NotFoundError, requireUser } from "@/lib/auth";
import { getProjectAccess } from "@/lib/data/members";
import {
  getChangeRequest,
  getReviewableItems,
  listEstimateItems,
  listHourSuggestions,
} from "@/lib/data/requests";
import { checkFinalization } from "@/lib/documents/render";

import { EstimateTable } from "./estimate-table";

export const metadata = { title: "Estimate" };

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  const user = await requireUser(`/projects/${id}/requests/${requestId}/estimate`);

  const access = await getProjectAccess(user.id, id);
  // An existing project this user cannot see is indistinguishable from one
  // that does not exist.
  if (!access) throw new NotFoundError("project");

  const [request, entries, estimateItems, hourSuggestions] = await Promise.all([
    getChangeRequest(user.id, requestId),
    getReviewableItems(user.id, requestId),
    listEstimateItems(user.id, requestId),
    listHourSuggestions(user.id, requestId),
  ]);

  const isOwner = access?.role === "owner";
  const check = checkFinalization(entries, estimateItems);
  const unreviewed = entries.filter((entry) => entry.review === null).length;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={`/projects/${id}`} className="hover:text-foreground">
              {access!.project.name}
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
        title="Estimate the additional work"
        description="Break the additional work into components and enter your own hours. The application does the arithmetic."
        actions={
          <ButtonLink
            href={`/projects/${id}/requests/${requestId}/documents`}
            variant="primary"
          >
            Generate documents
          </ButtonLink>
        }
      />

      {!isOwner ? (
        <Notice tone="info" className="mb-4" title="Read-only — you are a teammate on this project">
          <p>
            The estimate is the project owner&rsquo;s to enter. You can review it here; hours,
            rates and totals cannot be changed from your session.
          </p>
        </Notice>
      ) : null}

      {unreviewed > 0 ? (
        <Notice tone="warning" className="mb-4" title="Some items are not reviewed yet">
          <p>
            {unreviewed} item{unreviewed === 1 ? "" : "s"} still need your decision before
            this change request can be finalized.{" "}
            <Link
              href={`/projects/${id}/requests/${requestId}`}
              className="underline underline-offset-2"
            >
              Review them
            </Link>
            .
          </p>
        </Notice>
      ) : null}

      <EstimateTable
        projectId={id}
        requestId={requestId}
        currency={access!.project.currency}
        defaultRate={access!.project.defaultRate}
        items={estimateItems}
        entries={entries}
        taxLabel={request.taxLabel}
        taxRate={request.taxRate}
        suggestions={hourSuggestions}
        readOnly={!isOwner}
      />

      {check.blockers.length > 0 ? (
        <div className="mt-4">
          <Notice tone="warning" title="Before this can be finalized">
            <ul className="list-disc space-y-1 pl-5">
              {check.blockers.map((blocker, index) => (
                <li key={index}>{blocker}</li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}
    </>
  );
}
