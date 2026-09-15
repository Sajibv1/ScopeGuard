"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { addContextAction, flagLegalTopicsAction, reanalyzeAction } from "../actions";
import { AssessmentCard } from "./assessment-card";
import { SourceViewer } from "@/components/source-viewer";
import { Button, Card, Notice, OcrCaption, RecapCaption, textareaClass, TranscriptCaption } from "@/components/ui";
import type { Highlight } from "@/lib/highlight";
import type {
  ChangeRequest,
  LegalFlag,
  ReviewableItem,
  ScopeDocument,
} from "@/lib/types";

/**
 * The assessment review screen.
 *
 * Evidence stays one click away: selecting a quote scrolls the agreement to
 * the exact clause and highlights it. That is the plan's central promise —
 * the user can always check the claim against the document.
 */
export function ReviewWorkspace({
  projectId,
  request,
  document,
  entries,
  staleIds,
  legalFlags,
  canEdit,
}: {
  projectId: string;
  request: ChangeRequest;
  document: ScopeDocument;
  entries: ReviewableItem[];
  staleIds: string[];
  /** Internal topic flags, when the user has opted into drafting them. */
  legalFlags: LegalFlag[];
  /** False for teammates — reviews are the owner's decisions. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [context, setContext] = useState(request.userContext ?? "");
  const [showContext, setShowContext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Every verified quote across every item becomes a highlight, so the
  // agreement shows all cited clauses at once and the selected one stands out.
  const highlights = useMemo<Highlight[]>(() => {
    const all: Highlight[] = [];

    for (const entry of entries) {
      if (!entry.assessment) continue;
      for (const evidence of [
        ...entry.assessment.supportingEvidence,
        ...entry.assessment.conflictingEvidence,
      ]) {
        all.push({
          id: `${evidence.start}-${evidence.end}`,
          start: evidence.start,
          end: evidence.end,
        });
      }
    }

    return all;
  }, [entries]);

  const staleSet = new Set(staleIds);
  const reviewed = entries.filter((entry) => entry.review !== null).length;
  const flagsByItem = new Map<string, LegalFlag[]>();
  for (const flag of legalFlags) {
    const list = flagsByItem.get(flag.requestItemId) ?? [];
    list.push(flag);
    flagsByItem.set(flag.requestItemId, list);
  }

  function reanalyze() {
    startTransition(async () => {
      const result = await reanalyzeAction(projectId, request.id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function flagTopics() {
    startTransition(async () => {
      const result = await flagLegalTopicsAction(projectId, request.id);
      // Warnings here mean flags were dropped for reading as legal
      // conclusions — shown, never swallowed.
      if (result.error) setError(result.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="space-y-3 lg:order-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {reviewed} of {entries.length} item{entries.length === 1 ? "" : "s"} reviewed
          </p>

          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <>
                <Button onClick={() => setShowContext((value) => !value)} disabled={pending}>
                  Add context
                </Button>
                <Button onClick={reanalyze} disabled={pending}>
                  {pending ? "Re-analysing…" : "Re-analyse"}
                </Button>
                {/*
                  Opt-in topic flags (§8 honest version): names contract-adjacent
                  subjects for a professional to look at. Never a conclusion, and
                  never shown to the client — the flags render in AssessmentCards,
                  which are internal.
                */}
                <Button onClick={flagTopics} disabled={pending || entries.length === 0}>
                  {pending ? "Working…" : "Flag legal topics"}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {showContext ? (
          <ContextForm
            projectId={projectId}
            requestId={request.id}
            value={context}
            onChange={setContext}
            onDone={() => {
              setShowContext(false);
              router.refresh();
            }}
          />
        ) : request.userContext ? (
          <Notice tone="info" title="Context you provided">
            <p className="whitespace-pre-wrap text-sm">{request.userContext}</p>
            <p className="mt-1.5 text-xs opacity-80">
              This informed the analysis but is not quoted as scope evidence.
            </p>
          </Notice>
        ) : null}

        {entries.length === 0 ? (
          <Notice tone="warning" title="No items were extracted">
            <p className="mb-3">
              The client message is saved. You can re-run the analysis, or add items yourself.
            </p>
            <Button onClick={reanalyze} disabled={pending}>
              Re-analyse
            </Button>
          </Notice>
        ) : (
          entries.map((entry) => (
            <AssessmentCard
              key={entry.item.id}
              projectId={projectId}
              requestId={request.id}
              item={entry.item}
              assessment={entry.assessment}
              review={entry.review}
              stale={staleSet.has(entry.item.id)}
              onFocusEvidence={setActiveEvidenceId}
              activeEvidenceId={activeEvidenceId}
              legalFlags={flagsByItem.get(entry.item.id) ?? []}
              readOnly={!canEdit}
            />
          ))
        )}
      </div>

      {/* The agreement, always visible for checking. */}
      <div className="lg:order-2">
        <Card className="flex max-h-[80vh] flex-col overflow-hidden lg:sticky lg:top-20">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold text-foreground">{document.title}</h2>
            {document.ocrApplied ? (
              <div className="mt-0.5">
                <OcrCaption confidence={document.ocrConfidence ?? 0} />
              </div>
            ) : document.transcriptApplied ? (
              <div className="mt-0.5">
                <TranscriptCaption />
              </div>
            ) : document.sourceKind === "recap" ? (
              <div className="mt-0.5">
                <RecapCaption />
              </div>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                The agreed scope. Cited clauses are highlighted.
              </p>
            )}
          </div>
          <div className="overflow-y-auto px-4 py-3">
            <SourceViewer
              text={document.extractedText}
              highlights={highlights}
              activeId={activeEvidenceId}
              onSelectHighlight={setActiveEvidenceId}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function ContextForm({
  projectId,
  requestId,
  value,
  onChange,
  onDone,
}: {
  projectId: string;
  requestId: string;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card className="p-3.5">
      <h3 className="text-sm font-medium text-foreground">Additional context received</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        Answer an open question — for example how many revision rounds are already used.
        This is stored as your context, not as a clause in the agreement, and the analysis
        will re-run.
      </p>

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder="One revision round has been used so far."
        className={`${textareaClass} mt-2`}
      />

      {error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : null}

      <div className="mt-2 flex gap-2">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const formData = new FormData();
              formData.set("context", value);
              const result = await addContextAction(projectId, requestId, {}, formData);
              if (result.error) setError(result.error);
              else onDone();
            });
          }}
        >
          {pending ? "Saving and re-analysing…" : "Save and re-analyse"}
        </Button>
        <Button onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
