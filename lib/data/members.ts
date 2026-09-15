/**
 * Team membership, invites and internal approvals.
 *
 * Access model (migration 0005):
 *
 *   - The OWNER keeps every write. Members are read-only as far as the
 *     existing tables are concerned — their SELECT policies allow project
 *     members, the write policies never did.
 *   - The one thing a member writes is their own approval row, and only in a
 *     project they belong to. The action layer checks the role; RLS checks
 *     membership and row ownership.
 *   - Joining happens through accept_project_invite (a security-definer RPC
 *     where the invite token is the capability), never through a plain
 *     insert that a stranger could forge.
 */

import "server-only";

import { NotFoundError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type {
  ChangeApproval,
  MemberRole,
  Project,
  ProjectInvite,
  ProjectMember,
  ProjectRole,
} from "@/lib/types";

import { toChangeApproval, toProject, toProjectInvite, toProjectMember } from "./mappers";

export interface ProjectAccess {
  project: Project;
  /** The signed-in user's role. "owner" created the project. */
  role: ProjectRole;
}

/**
 * The project as this user may see it, or null.
 *
 * RLS decides visibility (owner or member); this function reports WHICH of
 * the two, so pages can gate edit controls and the approval UI. Callers
 * treat null as a 404 — an existing project you cannot see is indistinguish
 * from one that does not exist.
 */
export async function getProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess | null> {
  const supabase = await createClient();

  // RLS allows this row only for the owner and project members.
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw error;
  if (!project) return null;

  if (project.owner_id === userId) {
    return { project: toProject(project), role: "owner" };
  }

  // The row was visible, so the user must be a member — but read the role
  // rather than assuming, so a future policy change surfaces here.
  const { data: membership, error: memberError } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) throw memberError;

  return {
    project: toProject(project),
    role: (membership?.role as MemberRole) ?? "viewer",
  };
}

/** The full roster: stored members plus the synthesized owner entry. */
export interface RosterEntry extends ProjectMember {
  isOwner: boolean;
}

export async function listRoster(userId: string, projectId: string): Promise<RosterEntry[]> {
  const supabase = await createClient();

  const [projectResult, membersResult] = await Promise.all([
    supabase.from("projects").select("id, owner_id, created_at").eq("id", projectId).maybeSingle(),
    supabase
      .from("project_members")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
  ]);

  if (projectResult.error) throw projectResult.error;
  if (membersResult.error) throw membersResult.error;
  if (!projectResult.data) throw new NotFoundError("project");

  const owner: RosterEntry = {
    id: `owner-${projectResult.data.id}`,
    projectId,
    userId: projectResult.data.owner_id,
    role: "admin",
    addedBy: null,
    createdAt: projectResult.data.created_at,
    isOwner: true,
  };

  const members: RosterEntry[] = (membersResult.data ?? []).map((row: Record<string, unknown>) => ({
    ...toProjectMember(row),
    isOwner: false,
  }));

  return [owner, ...members];
}

/** Pending invites for the team page. RLS shows these to admins only. */
export async function listPendingInvites(
  userId: string,
  projectId: string,
): Promise<ProjectInvite[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_invites")
    .select("*")
    .eq("project_id", projectId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toProjectInvite);
}

export async function createInvite(
  userId: string,
  projectId: string,
  role: MemberRole,
): Promise<ProjectInvite> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_invites")
    .insert({ project_id: projectId, role, created_by: userId })
    .select()
    .single();

  if (error) throw error;
  return toProjectInvite(data);
}

export async function revokeInvite(userId: string, inviteId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("project_invites").delete().eq("id", inviteId);
  if (error) throw error;
}

/** Remove a member: an admin may remove anyone, anyone may remove themselves. */
export async function removeMember(
  userId: string,
  projectId: string,
  memberId: string,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("id", memberId)
    .eq("project_id", projectId);

  if (error) throw error;
}

/** Change a member's role. RLS restricts this to admins. */
export async function updateMemberRole(
  userId: string,
  projectId: string,
  memberId: string,
  role: MemberRole,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("project_members")
    .update({ role })
    .eq("id", memberId)
    .eq("project_id", projectId);

  if (error) throw error;
}

// ── Internal approvals ───────────────────────────────────────────────────────

export async function listApprovals(
  userId: string,
  requestId: string,
): Promise<ChangeApproval[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("change_approvals")
    .select("*")
    .eq("change_request_id", requestId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toChangeApproval);
}

export interface RecordApprovalInput {
  requestId: string;
  role: MemberRole;
  decision: "approved" | "changes_requested";
  note: string | null;
}

/**
 * Record this user's sign-off on a change request.
 *
 * One per person per request (the unique constraint); a repeat returns a
 * plain Error rather than a database code, so the UI can say what happened.
 */
export async function recordApproval(
  userId: string,
  input: RecordApprovalInput,
): Promise<ChangeApproval> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("change_approvals")
    .insert({
      change_request_id: input.requestId,
      owner_id: userId,
      role: input.role,
      decision: input.decision,
      note: input.note,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("You have already recorded a decision on this change request.");
    }
    throw error;
  }

  return toChangeApproval(data);
}

// ── Invite RPCs (security definer on the database side) ──────────────────────

export interface InvitePreview {
  projectName: string;
  clientName: string | null;
  role: MemberRole;
  accepted: boolean;
  alreadyMember: boolean;
}

/** What the invite landing page may show before joining. Token is the key. */
export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("preview_project_invite", { p_token: token });

  if (error) throw error;
  if (!data) return null;

  return {
    projectName: data.projectName,
    clientName: data.clientName ?? null,
    role: data.role,
    accepted: data.accepted,
    alreadyMember: data.alreadyMember,
  };
}

/** Accept an invite and return the project id to redirect to. */
export async function acceptInvite(token: string): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("accept_project_invite", { p_token: token });

  if (error) throw error;
  return data as string;
}
