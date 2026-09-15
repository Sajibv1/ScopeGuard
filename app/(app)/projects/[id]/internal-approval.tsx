"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { recordInternalApprovalAction } from "./requests/[requestId]/documents/actions";
import { Button, Card, Notice, textareaClass } from "@/components/ui";
import type { ApprovalGate } from "@/lib/approvals";
import type { ChangeApproval, ProjectRole } from "@/lib/types";

/**
 * The internal approval panel (§8 approval chains, honest version).
 *
 * Shows on the documents screen while a change request is READY to send:
 *
 *   - the owner sees whether the send gate is satisfied — they cannot send
 *     until an approver or admin teammate signs off;
 *   - a teammate with approval rights records the sign-off here;
 *   - everyone sees who signed off (a human act by a named teammate, never a
 *     signature and never client-facing).
 *
 * "Request changes" returns the request to draft; the database trigger then
 * clears sign-offs so the revision needs a fresh look.
 */
export function InternalApprovalPanel({
  projectId,
  requestId,
  viewerRole,
  viewerId,
  gate,
  approvals,
}: {
  projectId: string;
  requestId: string;
  /** The signed-in user's role on this project. */
  viewerRole: ProjectRole;
  /** To mark the viewer's own sign-off in the list. */
  viewerId: string;
  gate: ApprovalGate;
  approvals: ChangeApproval[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canApprove = viewerRole === "admin" || viewerRole === "approver";
  const alreadySignedOff = approvals.some((approval) => approval.approverId === viewerId);

  function record(decision: "approved" | "changes_requested") {
    startTransition(async () => {
      const result = await recordInternalApprovalAction(projectId, requestId, decision, note);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-foreground">Internal approval</h2>

      {gate.required ? (
        gate.satisfied ? (
          <Notice tone="success" className="mt-2" title="Signed off — clear to send">
            <p>
              A teammate with approval rights has signed off on this change order. The owner
              can mark it sent.
            </p>
          </Notice>
        ) : (
          <Notice
            tone="warning"
            className="mt-2"
            title="A teammate sign-off is required before sending"
          >
            <p>
              This project has teammates with the approver or admin role, so the change order
              cannot be marked sent until one of them signs off here. This is an internal
              record — it is never shown to the client.
            </p>
          </Notice>
        )
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          No teammates with approval rights are on this project, so sending needs no internal
          sign-off. Add an approver on the team page to require a second pair of eyes.
        </p>
      )}

      {canApprove && !alreadySignedOff ? (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            You are recording your own review of this change order. Approving clears it for
            sending; requesting changes returns it to draft and clears sign-offs.
          </p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Optional for approval, required for requesting changes — say what needs to change."
            aria-label="Internal approval note"
            className={textareaClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => record("approved")} disabled={pending}>
              {pending ? "Recording…" : "Approve for sending"}
            </Button>
            <Button variant="danger" onClick={() => record("changes_requested")} disabled={pending}>
              Request changes
            </Button>
          </div>
        </div>
      ) : null}

      {canApprove && alreadySignedOff ? (
        <p className="mt-3 text-xs text-muted-foreground">
          You have already recorded your decision on this change order. Sign-offs are cleared
          when the request returns to draft.
        </p>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      {approvals.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
          {approvals.map((approval) => (
            <li key={approval.id} className="text-[13px] leading-snug">
              <span className="font-medium text-foreground">
                {approval.approverId === viewerId ? "You" : "A teammate"}
              </span>{" "}
              <span className={approval.decision === "approved" ? "text-ok" : "text-notice-warn-fg"}>
                {approval.decision === "approved"
                  ? "approved this for sending"
                  : "requested changes"}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {approval.role} · {formatDay(approval.createdAt)}
              </span>
              {approval.note ? (
                <span className="block text-muted-foreground">&ldquo;{approval.note}&rdquo;</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}
