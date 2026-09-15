"use client";

import { useMemo, useState, useTransition } from "react";

import {
  confirmScopeAction,
  retryExtractionAction,
  saveScopeItemsAction,
  type ScopeFormState,
} from "./actions";
import { SourceViewer } from "@/components/source-viewer";
import {
  Button,
  Card,
  inputClass,
  Notice,
  OcrCaption,
  RecapCaption,
  textareaClass,
  TranscriptCaption,
} from "@/components/ui";
import type { Highlight } from "@/lib/highlight";
import {
  SCOPE_CATEGORIES,
  SCOPE_CATEGORY_LABELS,
  TRANSCRIPT_COMMITMENT_LABELS,
  type ScopeCategory,
  type ScopeDocument,
  type ScopeItem,
  type TranscriptCommitment,
} from "@/lib/types";

interface EditableItem {
  key: string;
  category: ScopeCategory;
  description: string;
  sourceQuote: string | null;
  sourceLocator: string | null;
  quoteStart: number | null;
  quoteEnd: number | null;
  userAdded: boolean;
  commitment: TranscriptCommitment | null;
  provenance: "document" | "memory";
}

/**
 * The scope confirmation screen (plan Feature 4).
 *
 * Two columns: the agreement on the left, the extracted items on the right.
 * Selecting an item highlights the clause it came from, which is what lets a
 * user check the model's reading rather than take it on trust.
 */
export function ScopeReview({
  projectId,
  versionId,
  document,
  initialItems,
  rejected,
  confirmed,
}: {
  projectId: string;
  versionId: string;
  document: ScopeDocument;
  initialItems: ScopeItem[];
  rejected?: Array<{ description: string; reason: string }>;
  confirmed: boolean;
}) {
  const [items, setItems] = useState<EditableItem[]>(() =>
    initialItems.map((item, index) => ({
      key: item.id || `item-${index}`,
      category: item.category,
      description: item.description,
      sourceQuote: item.sourceQuote,
      sourceLocator: item.sourceLocator,
      quoteStart: item.quoteStart,
      quoteEnd: item.quoteEnd,
      userAdded: item.userAdded,
      commitment: item.commitment,
      provenance: item.provenance,
    })),
  );

  const [activeKey, setActiveKey] = useState<string | null>(items[0]?.key ?? null);
  const [state, setState] = useState<ScopeFormState>({});
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  const highlights = useMemo<Highlight[]>(
    () =>
      items
        .filter((item) => item.quoteStart !== null && item.quoteEnd !== null)
        .map((item) => ({
          id: item.key,
          start: item.quoteStart!,
          end: item.quoteEnd!,
        })),
    [items],
  );

  const evidenceCount = items.filter((item) => !item.userAdded).length;
  const memoryCount = items.filter((item) => item.provenance === "memory").length;
  const userAddedCount = items.length - evidenceCount - memoryCount;

  function update(key: string, patch: Partial<EditableItem>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
    setDirty(true);
    setState({});
  }

  function remove(key: string) {
    setItems((current) => current.filter((item) => item.key !== key));
    setDirty(true);
    setState({});
  }

  function addItem() {
    const key = `new-${Date.now()}`;
    setItems((current) => [
      ...current,
      {
        key,
        category: "included_functionality",
        description: "",
        sourceQuote: null,
        sourceLocator: null,
        quoteStart: null,
        quoteEnd: null,
        userAdded: true,
        commitment: null,
        provenance: "document",
      },
    ]);
    setActiveKey(key);
    setDirty(true);
  }

  function save(then?: () => void) {
    startTransition(async () => {
      const result = await saveScopeItemsAction(
        projectId,
        versionId,
        items.map((item) => ({
          category: item.category,
          description: item.description,
          sourceQuote: item.sourceQuote,
          sourceLocator: item.sourceLocator,
          quoteStart: item.quoteStart,
          quoteEnd: item.quoteEnd,
          userAdded: item.userAdded,
          commitment: item.commitment,
          provenance: item.provenance,
        })),
      );

      setState(result);
      if (result.ok) {
        setDirty(false);
        then?.();
      }
    });
  }

  function confirm() {
    save(() => {
      startTransition(async () => {
        const result = await confirmScopeAction(projectId, versionId);
        setState(result);
      });
    });
  }

  function retry() {
    startTransition(async () => {
      const result = await retryExtractionAction(projectId);
      setState(result);
      if (result.ok) window.location.reload();
    });
  }

  return (
    <div className="space-y-4">
      {rejected && rejected.length > 0 ? (
        <Notice tone="warning" title={`${rejected.length} extracted item${rejected.length === 1 ? " was" : "s were"} discarded`}>
          <p className="mb-2">
            These did not quote the document accurately, so they were not added. Nothing
            unverified is shown as scope.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {rejected.map((entry, index) => (
              <li key={index}>
                <span className="font-medium">{entry.description}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      {items.length === 0 ? (
        <Notice tone="warning" title="No scope items were extracted">
          <p className="mb-3">
            Your document is saved. You can retry extraction, or add the items yourself.
          </p>
          <div className="flex gap-2">
            <Button onClick={retry} disabled={pending}>
              {pending ? "Retrying…" : "Retry extraction"}
            </Button>
            <Button onClick={addItem}>Add an item manually</Button>
          </div>
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: the agreement, exactly as supplied. */}
        <Card className="flex max-h-[70vh] flex-col overflow-hidden lg:sticky lg:top-20">
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
                Original text · {document.extractedText.length.toLocaleString()} characters
              </p>
            )}
          </div>
          <div className="overflow-y-auto px-4 py-3">
            <SourceViewer
              text={document.extractedText}
              locators={document.locators}
              highlights={highlights}
              activeId={activeKey}
              onSelectHighlight={setActiveKey}
            />
          </div>
        </Card>

        {/* Right: what the model understood, for the user to correct. */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {evidenceCount} item{evidenceCount === 1 ? "" : "s"} from the document
              {memoryCount > 0 ? ` · ${memoryCount} from your notes` : ""}
              {userAddedCount > 0 ? ` · ${userAddedCount} added by you` : ""}
            </p>
            {!confirmed ? (
              <Button onClick={addItem} disabled={pending}>
                Add item
              </Button>
            ) : null}
          </div>

          {items.map((item) => (
            <Card
              key={item.key}
              className={`p-3.5 transition-colors ${
                activeKey === item.key ? "border-primary" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveKey(item.key)}
                className="mb-2 flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {item.userAdded
                    ? item.provenance === "memory"
                      ? "From your notes"
                      : "Added by you"
                    : (item.sourceLocator ?? "From document")}
                </span>
                {item.commitment && !item.userAdded ? (
                  <span
                    className={`text-xs font-medium ${
                      item.commitment === "agreed" ? "text-primary" : "text-notice-warn-fg"
                    }`}
                  >
                    {TRANSCRIPT_COMMITMENT_LABELS[item.commitment]}
                  </span>
                ) : null}
                {item.quoteStart !== null ? (
                  <span className="text-xs text-primary">Show in document</span>
                ) : null}
              </button>

              {/*
                A memory item carries no document evidence, and the flag
                sharpens once a real source exists: while the baseline is
                still the notes, it awaits the client's confirmation; once a
                reply document is in, an unconfirmed memory item means the
                reply did not cover it. Either way it must never read as
                agreed scope.
              */}
              {item.provenance === "memory" ? (
                <p className="mb-2 rounded border border-notice-warn-br bg-notice-warn-bg px-2 py-1 text-xs text-notice-warn-fg">
                  {document.sourceKind === "recap"
                    ? "Your recollection — the client has not confirmed this. Send the recap below to get it in writing."
                    : "The client's reply did not confirm this item — it is still only your recollection."}
                </p>
              ) : item.userAdded ? (
                <p className="mb-2 rounded border border-notice-warn-br bg-notice-warn-bg px-2 py-1 text-xs text-notice-warn-fg">
                  Your note — not quoted from the agreement.
                </p>
              ) : item.commitment && item.commitment !== "agreed" ? (
                <p className="mb-2 rounded border border-notice-warn-br bg-notice-warn-bg px-2 py-1 text-xs text-notice-warn-fg">
                  The client only {item.commitment === "discussed" ? "discussed" : "heard a suggestion about"} this in
                  the call — it is not a commitment unless you decide it is one.
                </p>
              ) : item.sourceQuote ? (
                <blockquote className="mb-2 border-l-2 border-border pl-2.5 font-serif text-[13px] leading-relaxed text-muted-foreground">
                  &ldquo;{item.sourceQuote}&rdquo;
                </blockquote>
              ) : null}

              <div className="space-y-2">
                <textarea
                  value={item.description}
                  onChange={(event) => update(item.key, { description: event.target.value })}
                  disabled={confirmed}
                  rows={2}
                  placeholder="What does this commit you to?"
                  className={`${textareaClass} text-sm disabled:bg-muted disabled:text-muted-foreground`}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={item.category}
                    onChange={(event) =>
                      update(item.key, { category: event.target.value as ScopeCategory })
                    }
                    disabled={confirmed}
                    className={`${inputClass} w-auto py-1 text-xs disabled:bg-muted`}
                  >
                    {SCOPE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {SCOPE_CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>

                  {!confirmed ? (
                    <button
                      type="button"
                      onClick={() => remove(item.key)}
                      className="ml-auto text-xs text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {!confirmed ? (
        <Card className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 p-3.5 shadow-sm">
          <div className="text-sm">
            <p className="font-medium text-foreground">
              {dirty ? "Unsaved changes" : "All changes saved"}
            </p>
            <p className="text-xs text-muted-foreground">
              Confirming freezes this baseline. Analysis can then run against it.
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => save()} disabled={pending || !dirty}>
              {pending ? "Saving…" : "Save draft"}
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={pending || items.length === 0}
            >
              Confirm baseline
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
