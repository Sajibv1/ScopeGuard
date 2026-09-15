"use client";

import { useActionState } from "react";

import { ingestScopeAction, type ScopeFormState } from "./actions";
import { Button, Field, Notice, inputClass, textareaClass } from "@/components/ui";
import { SCOPE_TEXT_LIMIT } from "@/lib/limits";

/**
 * Scope ingestion (plan Feature 3, P0 paste path).
 *
 * The limit is stated up front rather than enforced by silent truncation —
 * the plan requires that the application never quietly shortens the
 * agreement.
 */
export function ScopeIntakeForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<ScopeFormState, FormData>(
    ingestScopeAction.bind(null, projectId),
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Document title" hint="For your own reference on exports.">
        <input
          name="title"
          defaultValue="Statement of work"
          className={inputClass}
          placeholder="Statement of work"
        />
      </Field>

      <Field
        label="Scope text"
        required
        hint={`Paste the agreement you actually work from. Up to ${SCOPE_TEXT_LIMIT.toLocaleString()} characters — paste the scope section rather than an entire contract.`}
      >
        <textarea
          name="text"
          required
          rows={16}
          className={`${textareaClass} font-serif`}
          placeholder={"1. Deliverables\n\nThe developer will build a five-page marketing website…"}
        />
      </Field>

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Extracting scope…" : "Extract scope items"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your text is saved before analysis starts, so nothing is lost if extraction fails.
        </p>
      </div>
    </form>
  );
}
