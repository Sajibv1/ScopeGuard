"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { reviseScopeAction } from "./actions";
import { Button, Notice } from "@/components/ui";

/**
 * Starts a new baseline version.
 *
 * The warning is explicit that prior analyses stay pinned to the old version,
 * because the alternative — silently reassessing reviewed work against new
 * scope — is the failure mode plan §4 rules out.
 */
export function ReviseScopeButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return <Button onClick={() => setConfirming(true)}>Revise scope</Button>;
  }

  return (
    <div className="w-full max-w-md">
      <Notice tone="warning" title="Start a new baseline version?">
        <p className="mb-3">
          Your current items are copied into a new draft for editing. The confirmed version
          stays in force, and change requests already assessed keep their original baseline
          and evidence.
        </p>

        {error ? <p className="mb-2 text-destructive">{error}</p> : null}

        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await reviseScopeAction(projectId);
                if (result.error) setError(result.error);
                else router.refresh();
              })
            }
          >
            {pending ? "Creating…" : "Create new version"}
          </Button>
          <Button onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </Notice>
    </div>
  );
}
