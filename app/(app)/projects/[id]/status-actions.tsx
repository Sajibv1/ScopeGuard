"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { recordOutcomeAction } from "./requests/[requestId]/documents/actions";
import { Button, Card, Notice, textareaClass } from "@/components/ui";
import type { ChangeRequest, RequestStatus } from "@/lib/types";

const NEXT_STATUSES: Record<RequestStatus, Array<{ status: RequestStatus; label: string }>> = {
  draft: [{ status: "ready", label: "Mark ready" }],
  ready: [{ status: "sent", label: "Mark sent" }],
  sent: [
    { status: "approved", label: "Record approval" },
    { status: "declined", label: "Record decline" },
    // A sent request can return to draft for revision. The previously sent
    // snapshot stays frozen (plan §10).
    { status: "draft", label: "Return to draft" },
  ],
  approved: [{ status: "draft", label: "Return to draft" }],
  declined: [{ status: "draft", label: "Return to draft" }],
};

export function StatusActions({
  projectId,
  request,
}: {
  projectId: string;
  request: ChangeRequest;
}) {
  const router = useRouter();
  const [active, setActive] = useState<RequestStatus | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = NEXT_STATUSES[request.status] ?? [];

  function submit(status: RequestStatus) {
    startTransition(async () => {
      const result = await recordOutcomeAction(projectId, request.id, status, note || null);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setActive(null);
        setNote("");
        router.refresh();
      }
    });
  }

  if (active) {
    const requiresNote = active === "approved";

    return (
      <Card className="p-3.5">
        <h3 className="text-sm font-medium text-foreground">
          {active === "approved"
            ? "Record the client's approval"
            : active === "declined"
              ? "Record the client's decline"
              : active === "sent"
                ? "Mark as sent"
                : "Return to draft"}
        </h3>

        {active === "approved" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            This records what you were told. It is not an electronic signature, and the
            document will show it as &ldquo;approval recorded by user&rdquo;.
          </p>
        ) : null}

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder={
            requiresNote
              ? "Where did the approval come from? e.g. email from Dana, 12 March"
              : "Optional note"
          }
          className={`${textareaClass} mt-2`}
        />

        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

        <div className="mt-2 flex gap-2">
          <Button variant="primary" onClick={() => submit(active)} disabled={pending}>
            {pending ? "Recording…" : "Record"}
          </Button>
          <Button onClick={() => setActive(null)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button key={option.status} onClick={() => setActive(option.status)}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}
