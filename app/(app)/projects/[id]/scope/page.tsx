import Link from "next/link";

import { ButtonLink, Card, FixtureBanner, Notice, PageHeader } from "@/components/ui";
import { isFixtureMode } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { getProject, getScopeState } from "@/lib/data/projects";
import { formatDate } from "@/lib/documents/render";

import { ScopeIntakeTabs } from "./intake-tabs";
import { ScopeReview } from "./scope-review";
import { ReviseScopeButton } from "./revise-button";

export const metadata = { title: "Scope" };

export default async function ScopePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/projects/${id}/scope`);

  const [project, scope] = await Promise.all([
    getProject(user.id, id),
    getScopeState(user.id, id),
  ]);

  const fixture = isFixtureMode();

  // No document yet — show the intake form.
  if (!scope.document) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader
          eyebrow={<Link href={`/projects/${id}`}>{project.name}</Link>}
          title="Add the agreed scope"
          description="Paste or upload the statement of work, proposal, or contract section that defines what you agreed to build. ScopeGuard extracts the commitments and you confirm them."
        />

        {fixture ? (
          <div className="mb-4">
            <FixtureBanner />
          </div>
        ) : null}

        <Card className="p-5">
          <ScopeIntakeTabs projectId={id} />
        </Card>
      </div>
    );
  }

  const activeVersion = scope.draft ?? scope.confirmed!;
  const isConfirmed = scope.draft === null && scope.confirmed !== null;

  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/projects/${id}`}>{project.name}</Link>}
        title={isConfirmed ? "Confirmed scope baseline" : "Confirm the scope baseline"}
        description={
          isConfirmed
            ? `Version ${activeVersion.version}, confirmed ${formatDate(activeVersion.confirmedAt)}. This baseline is frozen — change requests stay linked to the version they were assessed against.`
            : "Check what was understood from your document before it is used to assess client requests. Click an item to see the clause it came from."
        }
        actions={
          isConfirmed ? (
            <>
              <ReviseScopeButton projectId={id} />
              <ButtonLink href={`/projects/${id}/requests/new`} variant="primary">
                Add a client request
              </ButtonLink>
            </>
          ) : null
        }
      />

      {fixture ? (
        <div className="mb-4">
          <FixtureBanner />
        </div>
      ) : null}

      {scope.draft && scope.confirmed ? (
        <Notice tone="info" className="mb-4" title="You are editing a new version">
          <p>
            Version {scope.confirmed.version} stays in force until you confirm this one.
            Existing change requests keep pointing at the version they were assessed against,
            so confirming will not change any analysis you have already reviewed.
          </p>
        </Notice>
      ) : null}

      {scope.document.sourceKind === "recap" ? (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="max-w-xl">
            <h2 className="text-sm font-semibold text-foreground">
              These notes are not in writing yet
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Download the recap and send it to your client — it asks them to confirm or correct
              what you understood{scope.document.callDate ? ` from the call on ${formatDate(scope.document.callDate)}` : " from your call"}. When their
              reply arrives, paste or upload it here: it becomes the verifiable baseline, and
              anything the reply does not confirm is flagged for your review.
            </p>
          </div>
          <ButtonLink href={`/projects/${id}/scope/recap`}>
            Download recap (PDF)
          </ButtonLink>
        </Card>
      ) : null}

      <ScopeReview
        projectId={id}
        versionId={activeVersion.id}
        document={scope.document}
        initialItems={scope.items}
        confirmed={isConfirmed}
      />
    </>
  );
}
