"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addEstimateLineAction,
  deleteEstimateLineAction,
  setTaxAction,
  suggestReferenceHoursAction,
  suggestWorkAction,
  updateEstimateLineAction,
} from "./actions";
import { Button, Card, Notice, inputClass } from "@/components/ui";
import {
  computeTotals,
  formatHours,
  formatMoney,
  fromDbNumeric,
  parseDecimal,
} from "@/lib/money";
import type { EstimateItem, HourSuggestion, ReviewableItem } from "@/lib/types";

/**
 * The estimate table (plan Feature 8).
 *
 * Totals are recomputed locally as the user types so the figure updates
 * immediately, but they use the SAME `computeTotals` the server and the
 * export use. There is no second formula anywhere, which is what makes
 * exported totals match on-screen totals by construction.
 */
export function EstimateTable({
  projectId,
  requestId,
  currency,
  defaultRate,
  items,
  entries,
  taxLabel,
  taxRate,
  suggestions,
  readOnly = false,
}: {
  projectId: string;
  requestId: string;
  currency: string;
  defaultRate: string | null;
  items: EstimateItem[];
  entries: ReviewableItem[];
  taxLabel: string | null;
  taxRate: string | null;
  /** AI reference drafts, keyed by estimate line. Display-only. */
  suggestions: HourSuggestion[];
  /** True for teammates viewing — the estimate is the owner's to enter. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newDescription, setNewDescription] = useState("");
  // Line whose remove button is armed for confirmation — deleting a line
  // also destroys its entered hours, so one click must not be enough.
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  // Local copy so typing feels immediate; the server is the source of truth
  // and a refresh re-reads it.
  const [draft, setDraft] = useState<Record<string, { hours: string; rate: string }>>(() =>
    Object.fromEntries(
      items.map((item) => [item.id, { hours: item.hours ?? "", rate: item.rate ?? "" }]),
    ),
  );

  // The tax rate is user input, same as hours and rates. It is parsed with
  // the same decimal-safe parser so what computes locally is what persists.
  const [tax, setTax] = useState({ label: taxLabel ?? "", rate: taxRate ?? "" });

  const rows = items.map((item) => ({
    item,
    hours: draft[item.id]?.hours ?? "",
    rate: draft[item.id]?.rate ?? "",
  }));

  const suggestionByLine = new Map(suggestions.map((s) => [s.estimateItemId, s]));

  function suggestReferenceHours() {
    startTransition(async () => {
      const result = await suggestReferenceHoursAction(projectId, requestId);
      if (result.error) setError(result.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  // An unparseable draft rate computes no tax until it is fixed on blur —
  // the parse error itself is surfaced by the server action on save.
  let parsedTaxRate: bigint | null = null;
  if (tax.rate.trim() !== "") {
    try {
      parsedTaxRate = parseDecimal(tax.rate);
    } catch {
      parsedTaxRate = null;
    }
  }

  const totals = computeTotals(
    rows.map((row) => ({
      hours: row.hours.trim() === "" ? null : row.hours,
      rate: row.rate.trim() === "" ? null : row.rate,
    })),
    parsedTaxRate,
  );

  function persist(itemId: string, patch: { hours?: string; rate?: string }) {
    startTransition(async () => {
      const result = await updateEstimateLineAction(projectId, requestId, itemId, patch);
      if (result.error) setError(result.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  function suggest() {
    startTransition(async () => {
      const result = await suggestWorkAction(projectId, requestId);
      if (result.error) setError(result.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  function persistTax() {
    startTransition(async () => {
      const result = await setTaxAction(projectId, requestId, tax);
      if (result.error) setError(result.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  }

  const additionalCount = entries.filter(
    (entry) => entry.review?.finalLabel === "potentially_additional",
  ).length;

  return (
    <div className="space-y-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Notice tone="info">
        <p className="text-sm">
          <strong>Hours are yours to enter.</strong> ScopeGuard can suggest what work a change
          involves, and — on request — a rough reference figure to react to. Neither enters a
          total: references are shown beside the empty input and the number that counts is
          always the one you type. Line totals are calculated by the application.
        </p>
      </Notice>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Work breakdown</h2>
            <p className="text-xs text-muted-foreground">
              {additionalCount} item{additionalCount === 1 ? "" : "s"} marked as potentially
              additional
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!readOnly ? (
              <>
                <Button onClick={suggest} disabled={pending}>
                  {pending ? "Working…" : "Suggest work components"}
                </Button>
                {/*
                  Opt-in reference drafts (§8 honest version): the model's rough
                  figures go to a display-only table. The input stays empty and
                  the user still types their own number.
                */}
                <Button
                  onClick={suggestReferenceHours}
                  disabled={pending || rows.length === 0}
                >
                  {pending ? "Working…" : "Draft reference hours"}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No estimate lines yet. Suggest components from your reviewed items, or add a line
            below.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Work</th>
                  <th className="w-24 px-2 py-2 font-medium">Hours</th>
                  <th className="w-32 px-2 py-2 font-medium">Rate</th>
                  <th className="w-32 px-2 py-2 text-right font-medium">Line total</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.item.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <p className="text-foreground">{row.item.description}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {row.item.aiSuggested ? (
                          <span className="rounded border border-border px-1 py-px">
                            Suggested
                          </span>
                        ) : null}
                        {entries.find((entry) => entry.item.id === row.item.requestItemId)
                          ?.item.title ?? "Not linked to a request item"}
                      </p>
                    </td>

                    <td className="px-2 py-2">
                      <input
                        inputMode="decimal"
                        value={row.hours}
                        disabled={readOnly}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [row.item.id]: {
                              hours: event.target.value,
                              rate: current[row.item.id]?.rate ?? "",
                            },
                          }))
                        }
                        onBlur={(event) => persist(row.item.id, { hours: event.target.value })}
                        placeholder="—"
                        aria-label={`Hours for ${row.item.description}`}
                        className={`${inputClass} px-2 py-1 text-right`}
                      />

                      {/*
                        The AI reference draft: displayed beside the input it
                        never fills. Once the user types their own figure the
                        reference stops mattering, so it only shows while the
                        input is empty. The rationale is rendered as text, not
                        a title tooltip — hover-only evidence is invisible to
                        keyboard and touch users.
                      */}
                      {row.hours.trim() === "" && suggestionByLine.has(row.item.id) ? (
                        <p className="mt-1 max-w-40 text-xs leading-tight text-muted-foreground">
                          AI reference:{" "}
                          {formatHours(
                            fromDbNumeric(suggestionByLine.get(row.item.id)!.draftHours),
                          )}{" "}
                          h — never in totals.{" "}
                          {suggestionByLine.get(row.item.id)!.rationale}
                        </p>
                      ) : null}
                    </td>

                    <td className="px-2 py-2">
                      <input
                        inputMode="decimal"
                        value={row.rate}
                        disabled={readOnly}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [row.item.id]: {
                              hours: current[row.item.id]?.hours ?? "",
                              rate: event.target.value,
                            },
                          }))
                        }
                        onBlur={(event) => persist(row.item.id, { rate: event.target.value })}
                        placeholder={defaultRate ?? "—"}
                        aria-label={`Rate for ${row.item.description}`}
                        className={`${inputClass} px-2 py-1 text-right`}
                      />
                    </td>

                    <td className="px-2 py-2 text-right tabular-nums text-foreground">
                      {row.hours.trim() === "" || row.rate.trim() === "" ? (
                        <span className="text-muted-foreground/70">—</span>
                      ) : (
                        formatMoney(totals.lines[index] ?? 0n, currency)
                      )}
                    </td>

                    <td className="px-2 py-2 text-right">
                      {!readOnly ? (
                        confirmingRemove === row.item.id ? (
                          <span className="inline-flex items-center gap-1">
                            <Button
                              variant="danger"
                              size="xs"
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                startTransition(async () => {
                                  await deleteEstimateLineAction(
                                    projectId,
                                    requestId,
                                    row.item.id,
                                  );
                                  setConfirmingRemove(null);
                                  router.refresh();
                                })
                              }
                            >
                              Remove
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              type="button"
                              disabled={pending}
                              onClick={() => setConfirmingRemove(null)}
                            >
                              Keep
                            </Button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Remove ${row.item.description}`}
                            onClick={() => setConfirmingRemove(row.item.id)}
                            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            ×
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-border font-medium">
                  <td className="px-4 py-3" colSpan={3}>
                    Subtotal
                    {totals.incomplete ? (
                      <span className="ml-2 text-xs font-normal text-notice-warn-fg">
                        Some lines have no hours entered
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {formatMoney(totals.subtotal, currency)}
                  </td>
                  <td />
                </tr>

                {/*
                  The tax row: the label and rate are the user's input, the
                  amount is computed by the same computeTotals the exports
                  use. A blank rate renders no tax anywhere.
                */}
                <tr className="border-t border-border">
                  <td className="py-2 pl-4 pr-2" colSpan={3}>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <input
                        value={tax.label}
                        disabled={readOnly}
                        onChange={(event) => setTax((t) => ({ ...t, label: event.target.value }))}
                        onBlur={persistTax}
                        placeholder="Tax"
                        aria-label="Tax label"
                        className={`${inputClass} w-28 px-2 py-1`}
                      />
                      <input
                        inputMode="decimal"
                        value={tax.rate}
                        disabled={readOnly}
                        onChange={(event) => setTax((t) => ({ ...t, rate: event.target.value }))}
                        onBlur={persistTax}
                        placeholder="%"
                        aria-label="Tax rate in percent"
                        className={`${inputClass} w-20 px-2 py-1 text-right`}
                      />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-foreground">
                    {totals.tax === null ? (
                      <span className="text-muted-foreground/70">—</span>
                    ) : (
                      formatMoney(totals.tax, currency)
                    )}
                  </td>
                  <td />
                </tr>

                <tr className="border-t border-border font-medium">
                  <td className="px-4 py-3" colSpan={3}>
                    Total
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {formatMoney(totals.total, currency)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {!readOnly ? (
          <div className="flex gap-2 border-t border-border px-4 py-3">
            <input
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              placeholder="Add a line of work…"
              className={inputClass}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!newDescription.trim()) return;
                  startTransition(async () => {
                    await addEstimateLineAction(projectId, requestId, {
                      description: newDescription,
                      requestItemId: null,
                    });
                    setNewDescription("");
                    router.refresh();
                  });
                }
              }}
            />
            <Button
              disabled={pending || !newDescription.trim()}
              onClick={() =>
                startTransition(async () => {
                  await addEstimateLineAction(projectId, requestId, {
                    description: newDescription,
                    requestItemId: null,
                  });
                  setNewDescription("");
                  router.refresh();
                })
              }
            >
              Add
            </Button>
          </div>
        ) : null}
      </Card>

      <p className="text-xs text-muted-foreground">
        Currency: {currency}. One currency per change request — conversions are deliberately out
        of scope. Tax is a rate you enter; the application only does the arithmetic.
        ScopeGuard does not turn hours into a delivery date.
      </p>
    </div>
  );
}
