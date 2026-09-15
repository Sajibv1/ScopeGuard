"use client";

import { useActionState, useEffect, useRef } from "react";

import { createProjectAction, updateProjectAction } from "./actions";
import { Button, Field, inputClass, Notice, textareaClass } from "@/components/ui";
import { CURRENCIES, type FormState } from "@/lib/forms";
import type { Project } from "@/lib/types";

export function ProjectForm({
  project,
  submitLabel = "Create project",
}: {
  project?: Project;
  submitLabel?: string;
}) {
  const action = project
    ? updateProjectAction.bind(null, project.id)
    : createProjectAction;

  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  // After a failed submit, move focus to the first invalid field so keyboard
  // and screen-reader users are not stranded where the submit left them (the
  // Field error is wired via aria-describedby and announced on focus).
  useEffect(() => {
    if (state.fieldErrors) {
      formRef.current
        ?.querySelector<HTMLElement>("[aria-invalid='true']")
        ?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <Field label="Project name" required error={state.fieldErrors?.name}>
        <input
          name="name"
          required
          defaultValue={project?.name}
          placeholder="Acme Marketing Website"
          className={inputClass}
        />
      </Field>

      <Field label="Client name" hint="Shown on exported documents.">
        <input
          name="clientName"
          defaultValue={project?.clientName ?? ""}
          placeholder="Acme Ltd"
          className={inputClass}
        />
      </Field>

      <Field label="Project description">
        <textarea
          name="description"
          rows={2}
          defaultValue={project?.description ?? ""}
          placeholder="Short context for your own reference."
          className={textareaClass}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Currency"
          required
          hint="One currency per change request."
          error={state.fieldErrors?.currency}
        >
          <select
            name="currency"
            defaultValue={project?.currency ?? "USD"}
            className={inputClass}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Default hourly rate"
          hint="Used to prefill estimates. You can change it per line."
          error={state.fieldErrors?.defaultRate}
        >
          <input
            name="defaultRate"
            inputMode="decimal"
            defaultValue={project?.defaultRate ?? ""}
            placeholder="85.00"
            className={inputClass}
          />
        </Field>
      </div>

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success">Saved.</Notice> : null}

      <div className="flex gap-2 pt-1">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
