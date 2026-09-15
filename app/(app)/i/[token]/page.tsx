import Link from "next/link";

import { ButtonLink, Card, Notice, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { previewInvite } from "@/lib/data/members";
import { MEMBER_ROLE_TEXT } from "@/lib/types";

import { acceptInviteAction } from "./actions";

export const metadata = { title: "Team invite" };

/**
 * The invite landing page.
 *
 * The token in the URL is the whole capability — anyone holding this link can
 * join with the role it carries, once. ScopeGuard never sends the link; the
 * project owner delivers it however they already talk to this person.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  // Signing in first, then returning here, is the normal invite flow.
  await requireUser(`/i/${token}`);

  const preview = await previewInvite(token);

  return (
    <>
      <PageHeader
        eyebrow="Team invite"
        title={preview ? preview.projectName : "This invite is not valid"}
        description={
          preview
            ? "You have been invited to review this project as a teammate."
            : undefined
        }
      />

      <div className="mx-auto max-w-2xl space-y-4">
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {!preview ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">
              The link is mistyped, revoked, or does not exist. Ask the project owner for a
              fresh invite.
            </p>
            <div className="mt-4">
              <ButtonLink href="/dashboard" variant="primary">
                Back to your projects
              </ButtonLink>
            </div>
          </Card>
        ) : preview.accepted ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">
              This invite link has already been used, so it no longer works. If you already
              joined {preview.projectName}, open it from your dashboard.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink href="/dashboard" variant="primary">
                Go to your projects
              </ButtonLink>
            </div>
          </Card>
        ) : preview.alreadyMember ? (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">
              You are already on {preview.projectName}. The invite link is used up — find the
              project on your dashboard.
            </p>
            <div className="mt-4">
              <ButtonLink href="/dashboard" variant="primary">
                Go to your projects
              </ButtonLink>
            </div>
          </Card>
        ) : (
          <Card className="p-6">
            <p className="text-sm text-foreground">
              <strong>{preview.projectName}</strong>
              {preview.clientName ? ` for ${preview.clientName}` : ""} — invited role:{" "}
              <strong className="capitalize">{preview.role}</strong>.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {MEMBER_ROLE_TEXT[preview.role]}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Joining gives you read access to the scope, assessments, estimates and
              documents. Your session is your own — the project owner keeps every edit.
            </p>

            <form action={acceptInviteAction.bind(null, token)} className="mt-4">
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Join as {preview.role}
              </button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
