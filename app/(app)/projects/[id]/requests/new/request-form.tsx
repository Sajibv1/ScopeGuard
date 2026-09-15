"use client";

import { useActionState, useEffect, useMemo, useRef } from "react";

import { createRequestAction } from "../actions";
import { Button, Field, Notice, inputClass, textareaClass } from "@/components/ui";
import { CLIENT_MESSAGE_LIMIT } from "@/lib/limits";
import type { FormState } from "@/lib/forms";

/**
 * Client request capture (plan Feature 5).
 *
 * The idempotency key is generated once when the form mounts and submitted
 * with it, so a double-click or an impatient second submit resolves to the
 * same change request instead of creating two.
 */
export function RequestForm({
  projectId,
  modelLabel,
  initialMessage,
  defaultSourceLabel = "email",
}: {
  projectId: string;
  modelLabel: string;
  /** Extracted from a recording or a screenshot; the user reviews it here. */
  initialMessage?: string;
  defaultSourceLabel?: "email" | "chat" | "call_notes" | "voice_note" | "video" | "screenshot" | "other";
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createRequestAction.bind(null, projectId),
    {},
  );

  const idempotencyKey = useMemo(
    () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
    [],
  );

  const formRef = useRef<HTMLFormElement>(null);

  // After a failed submit, move focus to the first invalid field so keyboard
  // and screen-reader users land on the problem instead of where they were.
  useEffect(() => {
    if (state.fieldErrors) {
      formRef.current
        ?.querySelector<HTMLElement>("[aria-invalid='true']")
        ?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <Field label="Request title" required error={state.fieldErrors?.title}>
        <input
          name="title"
          required
          placeholder="Menu updates and online ordering"
          className={inputClass}
        />
      </Field>

      <Field
        label="Client message"
        required
        error={state.fieldErrors?.clientMessage}
        hint={`Paste what your client actually wrote. Up to ${CLIENT_MESSAGE_LIMIT.toLocaleString()} characters.`}
      >
        <textarea
          name="clientMessage"
          required
          rows={12}
          defaultValue={initialMessage}
          className={textareaClass}
          placeholder={"Hi,\n\nCould you add online ordering and customer accounts? Also please swap the hero image…"}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Received on">
          <input type="date" name="receivedOn" className={inputClass} />
        </Field>

        <Field label="Where it came from">
          <select name="sourceLabel" defaultValue={defaultSourceLabel} className={inputClass}>
            <option value="email">Email</option>
            <option value="chat">Chat</option>
            <option value="voice_note">Voice note</option>
            <option value="video">Video</option>
            <option value="screenshot">Screenshot</option>
            <option value="call_notes">Call notes</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      <div className="space-y-2 border-t border-border pt-4">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Analysing against your scope…" : "Analyse against scope"}
        </Button>

        <p className="text-xs text-muted-foreground">
          {modelLabel === "fixture mode"
            ? "Running in fixture mode — no data leaves this server."
            : `Your scope document and this message are sent to OpenAI (${modelLabel}) for analysis. Do not paste material you are not permitted to share.`}
        </p>
        <p className="text-xs text-muted-foreground">
          Your message is saved before analysis begins, so nothing is lost if it fails.
        </p>
      </div>
    </form>
  );
}
