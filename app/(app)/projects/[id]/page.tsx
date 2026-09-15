import Link from "next/link";

import { ButtonLink, Card, EmptyState, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { requireUser, NotFoundError } from "@/lib/auth";
import { sendGate } from "@/lib/approvals";
import { getProjectAccess, listApprovals, listRoster } from "@/lib/data/members";
import { getConfirmedVersion, getScopeState } from "@/lib/data/projects";
import { listChangeRequests } from "@/lib/data/requests";
import { formatDate } from "@/lib/documents/render";

import { StatusActions } from "./status-actions";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/projects/${id}`);

  const access = await getProjectAccess(user.id, id);
  // An existing project this user cannot see is indistinguishable from one
  // that does not exist.
  if (!access) throw new NotFoundError("project");

  const { project } = access;
  const isOwner = access.role === "owner";

  const [baseline, scope, requests, roster] = await Promise.all([
    getConfirmedVersion(user.id, id),
    getScopeState(user.id, id),
    listChangeRequests(user.id, id),
    listRoster(user.id, id),
  ]);

  // The send gate applies to finalized requests awaiting sending. Sign-offs
  // are fetched only for those, so the roster drives the cost.
  const readyRequests = requests.filter((request) => request.status === "ready");
  const readyApprovals = await Promise.all(
    readyRequests.map((request) => listApprovals(user.id, request.id)),
  );
  const teammates = roster.filter((member) => !member.isOwner);
  const gateByRequest = new Map(
    readyRequests.map((request, index) => [
      request.id,
      sendGate(teammates, readyApprovals[index] ?? []),
    ]),
  );

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/dashboard">Projects</Link>}
        title={project.name}
        description={
          <>
            {project.clientName ? `${project.clientName} · ` : ""}
            {project.currency}
            {project.defaultRate ? ` · default rate ${project.defaultRate}` : ""}
            {project.description ? (
              <span className="mt-1 block">{project.description}</span>
            ) : null}
          </>
        }
        actions={
          <>
            <ButtonLink href={`/projects/${id}/scope`}>
              {baseline ? "View scope" : "Add scope"}
            </ButtonLink>
            {isOwner && baseline ? (
              <ButtonLink href={`/projects/${id}/requests/new`} variant="primary">
                New request
              </ButtonLink>
            ) : null}
            <ButtonLink href={`/projects/${id}/team`}>Team</ButtonLink>
          </>
        }
      />

      {!isOwner ? (
        <Notice
          tone="info"
          className="mb-4"
          title={`Read-only — you are a teammate on this project (${access.role})`}
        >
          <p>
            You can review the scope, assessments, estimates and documents. New requests and
            edits are the project owner&rsquo;s to make.
          </p>
        </Notice>
      ) : null}

      {project.isSample ? (
        <Notice tone="warning" className="mb-4" title="Sample data">
          <p>
            This project is fictional and exists so you can try the workflow. Create your own
            project when you are ready.
          </p>
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-1">
          <h2 className="text-sm font-semibold text-foreground">Scope baseline</h2>

          {baseline ? (
            <>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-foreground">
                <span aria-hidden className="inline-block size-1.5 rounded-full bg-ok" />
                Version {baseline.version} confirmed
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatDate(baseline.confirmedAt)} · {scope.items.length} item
                {scope.items.length === 1 ? "" : "s"}
                {scope.items.some((item) => item.provenance === "memory")
                  ? " · includes unconfirmed notes"
                  : ""}
              </p>
              {scope.document?.sourceKind === "recap" ? (
                <p className="mt-2 rounded border border-notice-warn-br bg-notice-warn-bg px-2 py-1 text-xs text-notice-warn-fg">
                  This baseline is your call notes — send the recap and add the client's
                  reply to make it verifiable.
                </p>
              ) : null}
              {scope.draft ? (
                <p className="mt-2 rounded border border-notice-warn-br bg-notice-warn-bg px-2 py-1 text-xs text-notice-warn-fg">
                  A newer version is in draft.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Add the agreed scope to get started.
            </p>
          )}

          <div className="mt-3">
            <ButtonLink href={`/projects/${id}/scope`} className="w-full">
              {baseline ? "Review baseline" : "Add the agreed scope"}
            </ButtonLink>
          </div>
        </Card>

        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Change requests</h2>

          {requests.length === 0 ? (
            <EmptyState
              title="No change requests yet"
              description={
                baseline
                  ? "Paste a client request to compare it with this scope."
                  : "Confirm your scope baseline first, then paste a client request."
              }
              action={
                isOwner && baseline ? (
                  <ButtonLink href={`/projects/${id}/requests/new`} variant="primary">
                    Paste a client request
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-3">
              {requests.map((request) => (
                <li key={request.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${id}/requests/${request.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {request.reference} · {request.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Created {formatDate(request.createdAt)}
                          {request.sentAt ? ` · sent ${formatDate(request.sentAt)}` : ""}
                        </p>
                      </div>

                      <StatusBadge status={request.status} />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ButtonLink href={`/projects/${id}/requests/${request.id}`}>
                        Review
                      </ButtonLink>
                      <ButtonLink
                        href={`/projects/${id}/requests/${request.id}/documents`}
                      >
                        Documents
                      </ButtonLink>
                      <div className="ml-auto">
                        {isOwner ? <StatusActions projectId={id} request={request} /> : null}
                      </div>
                    </div>

                    {/*
                      The send gate, surfaced where the owner would click
                      "Mark sent": separation of duties means a teammate with
                      approval rights must sign off first.
                    */}
                    {isOwner && request.status === "ready"
                      ? (() => {
                          const gate = gateByRequest.get(request.id);
                          if (!gate?.required || gate.satisfied) return null;
                          return (
                            <p className="mt-2 rounded border border-notice-warn-br bg-notice-warn-bg px-2 py-1 text-xs text-notice-warn-fg">
                              A teammate with the approver or admin role must sign off on the
                              documents screen before this can be marked sent.
                            </p>
                          );
                        })()
                      : null}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
