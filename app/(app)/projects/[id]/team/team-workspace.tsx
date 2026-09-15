"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createInviteAction,
  removeMemberAction,
  revokeInviteAction,
  updateMemberRoleAction,
} from "./actions";
import { Button, Card, Notice } from "@/components/ui";
import { MEMBER_ROLE_TEXT } from "@/lib/types";
import type { MemberRole, ProjectInvite } from "@/lib/types";
import type { RosterEntry } from "@/lib/data/members";

/**
 * The team page (§8 team roles, honest version).
 *
 * Two deliberate constraints shape this screen:
 *
 *   - ScopeGuard never sends anything. An invite is a link you copy and
 *     deliver yourself — by whatever channel you already talk to this
 *     person on. No email is sent, so the "it never contacts your client"
 *     promise stays true.
 *   - There is no editor role. Members are read-only by the database, not
 *     by a checkbox this page forgot to enforce.
 */
export function TeamWorkspace({
  projectId,
  roster,
  invites,
  viewerId,
  canManage,
}: {
  projectId: string;
  roster: RosterEntry[];
  /** Pending invites, visible to admins only. */
  invites: ProjectInvite[];
  /** To label the viewer's own row. */
  viewerId: string;
  /** Owner or admin teammate. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [role, setRole] = useState<MemberRole>("approver");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  // Destructive row actions arm for a second click — one tap must not revoke
  // access or an invite.
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  // Unapplied role changes, keyed by membership id. The select only stages
  // the change; an explicit Save applies it, so a stray keypress while the
  // select has focus cannot rewrite a teammate's permissions.
  const [roleDraft, setRoleDraft] = useState<Record<string, MemberRole>>({});

  function invite() {
    startTransition(async () => {
      const result = await createInviteAction(projectId, role);
      if (result.error) setError(result.error);
      else {
        setError(null);
        // Built client-side so it is correct for the host the owner is
        // actually using. Shown once; the token stays in the database.
        setLink(`${window.location.origin}/i/${result.token}`);
        setCopied(false);
        router.refresh();
      }
    });
  }

  async function copyLink() {
    if (!link) return;
    // writeText rejects on insecure contexts or denied clipboard permission;
    // the link is one-time, so failing silently is not an option.
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy automatically — select the link text and copy it manually.");
    }
  }

  const teammates = roster.filter((member) => !member.isOwner);

  return (
    <div className="space-y-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {canManage ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-foreground">Invite a teammate</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            ScopeGuard sends nothing — no email, no notification. It creates a one-time link
            you copy and deliver yourself. The link joins the receiver to this project with
            the role you pick, and stops working once used.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(MEMBER_ROLE_TEXT) as MemberRole[]).map((option) => (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
                    role === option
                      ? "border-primary bg-card"
                      : "border-border bg-card hover:border-input"
                  }`}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    value={option}
                    checked={role === option}
                    onChange={() => setRole(option)}
                    className="size-3.5 accent-primary"
                  />
                  <span className="font-medium capitalize">{option}</span>
                </label>
              ))}
            </div>
            <Button variant="primary" onClick={invite} disabled={pending}>
              {pending ? "Creating…" : "Create invite link"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {MEMBER_ROLE_TEXT[role]}
          </p>

          {link ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium text-foreground">
                Invite link — copy it now, it is shown once
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2 py-1 text-xs">
                  {link}
                </code>
                <Button onClick={copyLink}>{copied ? "Copied" : "Copy link"}</Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Anyone with this link can join as {role}. You can revoke it from the pending
                list below as long as it is unused.
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {canManage && invites.length > 0 ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-foreground">Pending invites</h2>
          <ul className="mt-2 space-y-2">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <p className="text-sm text-foreground">
                  {invite.role} invite
                  <span className="ml-2 text-xs text-muted-foreground">
                    created {formatDay(invite.createdAt)}
                  </span>
                </p>
                <span className="flex flex-wrap items-center gap-2">
                  {confirmingRevoke === invite.id ? (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await revokeInviteAction(projectId, invite.id);
                            setConfirmingRevoke(null);
                            if (result.error) setError(result.error);
                            else router.refresh();
                          })
                        }
                      >
                        Confirm revoke
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => setConfirmingRevoke(null)}
                      >
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={pending}
                      onClick={() => setConfirmingRevoke(invite.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground">Who has access</h2>
        <ul className="mt-2 divide-y divide-border">
          {roster.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <p className="text-sm text-foreground">
                  {member.isOwner
                    ? member.userId === viewerId
                      ? "You (owner)"
                      : "Owner"
                    : member.userId === viewerId
                      ? "You"
                      : "Teammate"}
                  {member.isOwner ? (
                    <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                      owner
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">{MEMBER_ROLE_TEXT[member.role]}</p>
              </div>

              {!member.isOwner && canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={roleDraft[member.id] ?? member.role}
                    aria-label="Change teammate role"
                    disabled={pending}
                    onChange={(event) =>
                      setRoleDraft((current) => ({
                        ...current,
                        [member.id]: event.target.value as MemberRole,
                      }))
                    }
                    className="h-8 rounded-md border border-input bg-card px-2 text-sm text-foreground"
                  >
                    {(Object.keys(MEMBER_ROLE_TEXT) as MemberRole[]).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {roleDraft[member.id] != null && roleDraft[member.id] !== member.role ? (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await updateMemberRoleAction(
                              projectId,
                              member.id,
                              roleDraft[member.id]!,
                            );
                            if (result.error) setError(result.error);
                            else {
                              setRoleDraft((current) => {
                                const next = { ...current };
                                delete next[member.id];
                                return next;
                              });
                              router.refresh();
                            }
                          })
                        }
                      >
                        Save role
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          setRoleDraft((current) => {
                            const next = { ...current };
                            delete next[member.id];
                            return next;
                          })
                        }
                      >
                        Revert
                      </Button>
                    </>
                  ) : null}
                  {confirmingRemove === member.id ? (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await removeMemberAction(projectId, member.id);
                            setConfirmingRemove(null);
                            if (result.error) setError(result.error);
                            else router.refresh();
                          })
                        }
                      >
                        Confirm remove
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => setConfirmingRemove(null)}
                      >
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={pending}
                      onClick={() => setConfirmingRemove(member.id)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {teammates.length === 0 ? (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            Nobody else has access yet. Invite an approver to require a second pair of eyes
            before a change order can be sent.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}
