/**
 * The internal approval gate — pure logic, no database.
 *
 * One rule (§8 "approval chains", honest version): when a project has
 * teammates who can approve, a change order cannot be SENT to the client
 * until one of them has signed off. Solo projects keep the single-user flow.
 *
 * The approver is a different person from the preparer by construction: only
 * teammates (never the owner) appear in change_approvals, and anonymous auth
 * means every teammate is a distinct account. No prompt or promise could
 * deliver that separation — the data model does.
 */

import type { ChangeApproval, MemberRole, ProjectRole } from "./types";

/** Roles that count for the internal approval gate. */
export const APPROVAL_ROLES: readonly MemberRole[] = ["admin", "approver"];

export interface RosterEntry {
  role: MemberRole;
}

export interface ApprovalGate {
  /** True when the project has teammates who can approve. */
  required: boolean;
  /** True when sending is currently allowed. */
  satisfied: boolean;
}

/**
 * The send gate for a change request.
 *
 * Members are teammates only — the owner is not in the roster, so a solo
 * project (empty roster) never requires internal approval.
 */
export function sendGate(
  members: RosterEntry[],
  approvals: Pick<ChangeApproval, "decision">[],
): ApprovalGate {
  const required = members.some((member) =>
    (APPROVAL_ROLES as readonly string[]).includes(member.role),
  );
  if (!required) return { required: false, satisfied: true };

  return {
    required: true,
    satisfied: approvals.some((approval) => approval.decision === "approved"),
  };
}

/** Who may record an internal approval: teammates with approval rights. */
export function canApproveInternally(role: ProjectRole): boolean {
  return role === "admin" || role === "approver";
}
