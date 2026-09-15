"use client";

import { useState, useTransition } from "react";

import { reviewItemAction } from "../actions";
import { Button, LabelBadge, Notice, textareaClass } from "@/components/ui";
import {
  ASSESSMENT_LABELS,
  ASSESSMENT_LABEL_TEXT,
  type Assessment,
  type AssessmentLabel,
  type Evidence,
  type ItemReview,
  type LegalFlag,
  type RequestItem,
} from "@/lib/types";

/**
 * One reviewable request item (plan Features 6 and 7).
 *
 * The layout keeps three things visibly separate:
 *   - what the model proposed, with its evidence
 *   - what is missing or contradictory
 *   - what the USER decided
 *
 * An override never rewrites the model's record; it writes a review row
 * beside it, and the card shows both.
 */
export function AssessmentCard({
  projectId,
  requestId,
  item,
  assessment,
  review,
  stale,
  onFocusEvidence,
  activeEvidenceId,
  legalFlags = [],
  readOnly = false,
}: {
  projectId: string;
  requestId: string;
  item: RequestItem;
  assessment: Assessment | null;
  review: ItemReview | null;
  stale: boolean;
  onFocusEvidence: (id: string | null) => void;
  activeEvidenceId: string | null;
  /** Internal topic flags — never rendered into any export. */
  legalFlags?: LegalFlag[];
  /** True for teammates — the review is the owner's decision to record. */
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(!review && !readOnly);
  const [finalLabel, setFinalLabel] = useState<AssessmentLabel>(
    review?.finalLabel ?? assessment?.proposedLabel ?? "needs_clarification",
  );
  const [note, setNote] = useState(review?.note ?? "");
  const [contextBased, setContextBased] = useState(review?.userContextBased ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const proposed = assessment?.proposedLabel ?? null;
  const overridden = review !== null && proposed !== null && review.finalLabel !== proposed;
  const evidenceKey = `item-${item.id}`;

  function submit() {
    startTransition(async () => {
      const result = await reviewItemAction(projectId, requestId, {
        requestItemId: item.id,
        assessmentId: assessment?.id ?? null,
        finalLabel,
        note: note.trim() || null,
        userContextBased: contextBased,
      });

      if (result.error) setError(result.error);
      else {
        setError(null);
        setExpanded(false);
      }
    });
  }

  return (
    <article
      id={evidenceKey}
      className={`rounded-xl border bg-card ${
        // Unreviewed items carry the redline border — the pen marks what still
        // needs your decision. Reviewed cards quiet down.
        review ? "border-border" : "border-primary/50"
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
            {item.userAdded ? (
              <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                Added by you
              </span>
            ) : null}
          </div>

          {item.description ? (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          ) : null}

          <blockquote className="mt-2 border-l-2 border-border pl-2.5 text-[13px] italic text-muted-foreground">
            &ldquo;{item.sourceExcerpt}&rdquo;
            <span className="ml-1 not-italic text-xs">— from the client&rsquo;s message</span>
          </blockquote>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {review ? (
            <>
              <LabelBadge label={review.finalLabel} />
              <span className="text-xs text-muted-foreground">
                {readOnly ? "Owner's decision" : "Your decision"}
              </span>
            </>
          ) : proposed ? (
            <>
              <LabelBadge label={proposed} />
              <span className="text-xs text-muted-foreground">Proposed — not yet reviewed</span>
            </>
          ) : (
            <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">
              Not analysed
            </span>
          )}
        </div>
      </header>

      {/*
        Legal topic flags (§8 honest version): a named subject plus why it was
        raised. The label is explicit that this is not legal advice, and the
        flags never leave this internal card — exports render from
        lib/documents/render.ts, which never reads ai_legal_flags.
      */}
      {legalFlags.length > 0 ? (
        <div className="border-b border-border bg-muted/40 px-4 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">
            Contract-adjacent topics — AI pointers for a professional to review. Not legal
            advice; internal only, never shown to the client.
          </p>
          <ul className="mt-1.5 space-y-1">
            {legalFlags.map((flag) => (
              <li key={flag.id} className="text-[13px] leading-snug">
                <span className="font-medium text-foreground">{flag.topic}</span>
                <span className="text-muted-foreground"> — {flag.note}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-3 p-4">
        {stale ? (
          <Notice tone="warning" title="This item was re-analysed after your review">
            <p>
              Your decision was recorded against an earlier assessment. Review the current
              one below and save again to reconcile — nothing was changed automatically.
            </p>
          </Notice>
        ) : null}

        {overridden ? (
          <Notice tone="info">
            <p className="text-xs">
              You changed this from <strong>{ASSESSMENT_LABEL_TEXT[proposed!]}</strong> to{" "}
              <strong>{ASSESSMENT_LABEL_TEXT[review!.finalLabel]}</strong>.
              {review!.userContextBased
                ? " Based on context outside the agreement, which the export will label as such."
                : ""}
            </p>
          </Notice>
        ) : null}

        {assessment?.validationFailed && assessment.validationNotes ? (
          <Notice tone="warning" title="Automated checks changed this result">
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {assessment.validationNotes.split("\n").map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {assessment ? (
          <>
            <p className="text-sm leading-relaxed text-foreground">{assessment.explanation}</p>

            <EvidenceList
              title="Supporting evidence"
              evidence={assessment.supportingEvidence}
              emptyText="No supporting clause was found in the agreement."
              onFocus={onFocusEvidence}
              activeId={activeEvidenceId}
            />

            {assessment.conflictingEvidence.length > 0 ? (
              <EvidenceList
                title="Conflicting evidence"
                evidence={assessment.conflictingEvidence}
                tone="conflict"
                onFocus={onFocusEvidence}
                activeId={activeEvidenceId}
              />
            ) : null}

            {assessment.missingInformation.length > 0 ? (
              <div>
                <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
                  Missing information
                </h4>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                  {assessment.missingInformation.map((entry, index) => (
                    <li key={index}>{entry}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {assessment.suggestedQuestion ? (
              <div className="rounded-md border border-border bg-muted/50 px-3 py-2">
                <h4 className="text-xs font-semibold text-muted-foreground">
                  Suggested question
                </h4>
                <p className="mt-0.5 text-sm text-foreground">
                  &ldquo;{assessment.suggestedQuestion}&rdquo;
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            This item has no assessment yet. Run the analysis to compare it with your scope.
          </p>
        )}

        {expanded ? (
          <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold text-muted-foreground">
                Your assessment
              </legend>
              <div className="flex flex-wrap gap-2">
                {ASSESSMENT_LABELS.map((label) => (
                  <label
                    key={label}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
                      finalLabel === label
                        ? "border-primary bg-card"
                        : "border-border bg-card hover:border-input"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`label-${item.id}`}
                      value={label}
                      checked={finalLabel === label}
                      onChange={() => setFinalLabel(label)}
                      className="size-3.5 accent-primary"
                    />
                    {ASSESSMENT_LABEL_TEXT[label]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                Note
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder="Why did you decide this? Recorded with your review."
                className={textareaClass}
              />
            </label>

            {/*
              An override does not create evidence. If the decision rests on a
              phone call, that gets labelled as user-provided context rather
              than presented as something the agreement says.
            */}
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={contextBased}
                onChange={(event) => setContextBased(event.target.checked)}
                className="mt-0.5 size-3.5 accent-primary"
              />
              <span>
                This decision is based on context outside the written agreement
                <span className="block text-xs text-muted-foreground">
                  Exports will show it as user-provided context, not as a contract term.
                </span>
              </span>
            </label>

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <div className="flex gap-2">
              <Button variant="primary" onClick={submit} disabled={pending}>
                {pending ? "Saving…" : review ? "Update review" : "Mark reviewed"}
              </Button>
              {review ? (
                <Button onClick={() => setExpanded(false)} disabled={pending}>
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {review?.note ? `Your note: ${review.note}` : "Reviewed"}
            </p>
            {/* Reviews are the owner's decisions; teammates can read them. */}
            {readOnly ? null : (
              <Button onClick={() => setExpanded(true)}>Change decision</Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function EvidenceList({
  title,
  evidence,
  emptyText,
  tone = "support",
  onFocus,
  activeId,
}: {
  title: string;
  evidence: Evidence[];
  emptyText?: string;
  tone?: "support" | "conflict";
  onFocus: (id: string | null) => void;
  activeId: string | null;
}) {
  if (evidence.length === 0 && !emptyText) return null;

  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-muted-foreground">
        {title}
      </h4>

      {evidence.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {evidence.map((entry, index) => {
            const id = `${entry.start}-${entry.end}`;
            const active = activeId === id;

            return (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => onFocus(active ? null : id)}
                  className={`block w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                    active ? "border-primary bg-accent" : "border-border hover:border-input"
                  } ${tone === "conflict" ? "border-l-2 border-l-warn" : ""}`}
                >
                  <span className="block font-serif text-[13px] leading-relaxed text-foreground">
                    &ldquo;{entry.quote}&rdquo;
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{entry.locator}</span>
                    <span aria-hidden>·</span>
                    {/*
                      Every displayed quote has passed verification — the
                      validator drops the rest before they ever reach here.
                    */}
                    <span className="text-ok">✓ verified against source</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
