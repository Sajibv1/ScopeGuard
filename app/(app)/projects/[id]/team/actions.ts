"use server";

import { revalidatePath } from "next/cache";

import { NotFoundError, requireUser } from "@/lib/auth";
import {
  createInvite,
  getProjectAccess,
  removeMember,
  revokeInvite,
  updateMemberRole,
} from "@/lib/data/members";
import { recordEvent } from "@/lib/data/requests";
import { messageFor, type FormState } from "@/lib/forms";
import { MEMBER_ROLES, type MemberRole } from "@/lib/types";

export interface CreateInviteState extends FormState {
  /** The one-time token, so the client can build the invite link. */
  token?: string;
}

/** Admins only: the owner, or a teammate with the admin role. */
async function requireAdmin(userId: string, projectId: string) {
  const access = await getProjectAccess(userId, projectId);
  if (!access) throw new NotFoundError("project");

  if (access.role !== "owner" && access.role !== "admin") {
    throw new Error("Only the project owner or an admin teammate can manage the team.");
  }

  return access;
}

/**
 * Create an invite.
 *
 * ScopeGuard never contacts the client or anyone else: the link IS the
 * delivery. The token is single-use and shown once here — the database row
 * stores it, but the app surfaces it only at creation time.
 */
export async function createInviteAction(
  projectId: string,
  role: MemberRole,
): Promise<CreateInviteState> {
  const user = await requireUser();

  if (!(MEMBER_ROLES as readonly string[]).includes(role)) {
    return { error: "Pick a role: approver, admin or viewer." };
  }

  try {
    await requireAdmin(user.id, projectId);

    const invite = await createInvite(user.id, projectId, role);

    await recordEvent(user.id, {
      projectId,
      event: "Team invite created",
      note: `Role: ${role}. ScopeGuard does not send the link — copy it yourself.`,
    });

    revalidatePath(`/projects/${projectId}/team`);
    return { ok: true, token: invite.token };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function revokeInviteAction(
  projectId: string,
  inviteId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    await requireAdmin(user.id, projectId);
    await revokeInvite(user.id, inviteId);

    await recordEvent(user.id, {
      projectId,
      event: "Team invite revoked",
    });

    revalidatePath(`/projects/${projectId}/team`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function removeMemberAction(
  projectId: string,
  memberId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    await requireAdmin(user.id, projectId);
    await removeMember(user.id, projectId, memberId);

    await recordEvent(user.id, {
      projectId,
      event: "Team member removed",
    });

    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function updateMemberRoleAction(
  projectId: string,
  memberId: string,
  role: MemberRole,
): Promise<FormState> {
  const user = await requireUser();

  if (!(MEMBER_ROLES as readonly string[]).includes(role)) {
    return { error: "Pick a role: approver, admin or viewer." };
  }

  try {
    await requireAdmin(user.id, projectId);
    await updateMemberRole(user.id, projectId, memberId, role);

    await recordEvent(user.id, {
      projectId,
      event: "Team role changed",
      note: `New role: ${role}.`,
    });

    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}
