import Link from "next/link";

import { Notice, PageHeader } from "@/components/ui";
import { NotFoundError, requireUser } from "@/lib/auth";
import { getProjectAccess, listPendingInvites, listRoster } from "@/lib/data/members";

import { TeamWorkspace } from "./team-workspace";

export const metadata = { title: "Team" };

export default async function TeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/projects/${id}/team`);

  const access = await getProjectAccess(user.id, id);
  // An existing project this user cannot see is indistinguishable from one
  // that does not exist.
  if (!access) throw new NotFoundError("project");

  const canManage = access.role === "owner" || access.role === "admin";

  // RLS already restricts invites to admins; the role check avoids a wasted
  // round-trip and keeps the page honest about what it asked for.
  const [roster, invites] = await Promise.all([
    listRoster(user.id, id),
    canManage ? listPendingInvites(user.id, id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/projects/${id}`} className="hover:text-foreground">
            {access.project.name}
          </Link>
        }
        title="Team"
        description="Invite teammates to review your project. ScopeGuard sends nothing — you deliver the invite link yourself."
      />

      {!canManage ? (
        <Notice tone="info" className="mb-4" title="You can view the team, not manage it">
          <p>
            Managing invites and roles is limited to the project owner and admin teammates.
          </p>
        </Notice>
      ) : null}

      <TeamWorkspace
        projectId={id}
        roster={roster}
        invites={invites}
        viewerId={user.id}
        canManage={canManage}
      />
    </>
  );
}
