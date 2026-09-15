"use client";

import { useActionState } from "react";

import { ingestNotesAction, type ScopeFormState } from "./actions";
import { Button, Field, Notice, inputClass, textareaClass } from "@/components/ui";
import { SCOPE_TEXT_LIMIT } from "@/lib/limits";

/**
 * Rough-notes intake (plan §10, Tier 2): the call happened, there is no
 * recording and no document, and the user only has their memory.
 *
 * The boundary is stated on the form itself: nothing here counts as agreed.
 * The notes become unverified scope items and a recap PDF to send the
 * client — their reply is what makes any of it real.
 */
export function NotesIntakeForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<ScopeFormState, FormData>(
    ingestNotesAction.bind(null, projectId),
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Notice tone="warning" title="Notes are not an agreement">
        <p>
          ScopeGuard will structure these notes into unverified items and draft a recap you can
          send the client. Until they reply to confirm, nothing here is evidence of what was
          agreed.
        </p>
      </Notice>

      <Field label="Document title" hint="For your own reference on exports.">
        <input
          name="title"
          defaultValue="Notes from our call"
          className={inputClass}
          placeholder="Notes from our call"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Call date" hint="Stated on the recap so the client knows which call it recaps.">
          <input type="date" name="callDate" className={inputClass} />
        </Field>
        <Field label="Participants" hint="Who was on the call, e.g. “Priya (client), me”.">
          <input name="participants" className={inputClass} placeholder="Priya, me" />
        </Field>
      </div>

      <Field
        label="Your notes"
        required
        hint={`Rough is fine — bullet fragments work. Up to ${SCOPE_TEXT_LIMIT.toLocaleString()} characters.`}
      >
        <textarea
          name="text"
          required
          rows={12}
          className={`${textareaClass} font-serif`}
          placeholder={
            "- We'll build the five-page site, English only\n- Revisions: two rounds included\n- Client sends logo and copy by Friday\n- Maybe a blog later, not now"
          }
        />
      </Field>

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Structuring notes…" : "Structure my notes"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your notes are saved before analysis starts, so nothing is lost if structuring fails.
        </p>
      </div>
    </form>
  );
}
