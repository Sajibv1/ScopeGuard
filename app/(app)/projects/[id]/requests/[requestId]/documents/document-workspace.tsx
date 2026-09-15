"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  finalizeAction,
  generateDocumentsAction,
  saveSectionsAction,
  type DraftState,
} from "./actions";
import { Button, Card, Notice, textareaClass } from "@/components/ui";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DRAFT_ORDER_SECTIONS, DRAFT_REPLY_SECTIONS, SECTION_TITLES } from "@/lib/ai/schemas";
import { gmailComposeUrl } from "@/lib/integrations/gmail";
import type { RenderedChangeOrder } from "@/lib/documents/render";
import type { DocumentVersion, Tone } from "@/lib/types";

/**
 * The document review screen (plan Feature 9).
 *
 * Editable narrative on the left, the deterministic change order on the
 * right. The figures in the preview are rendered from stored records, so
 * editing prose can never change a total.
 */
export function DocumentWorkspace({
  projectId,
  requestId,
  document,
  rendered,
  replyText,
  blockers,
  warnings,
  requestApproved,
  canEdit = true,
}: {
  projectId: string;
  requestId: string;
  document: DocumentVersion | null;
  rendered: RenderedChangeOrder;
  replyText: string;
  blockers: string[];
  warnings: string[];
  /** True when the change request is approved — invoices unlock then. */
  requestApproved: boolean;
  /** False for teammates — drafting and finalizing are the owner's to do. */
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [tone, setTone] = useState<Tone>(document?.tone ?? "friendly");
  const [sections, setSections] = useState<Record<string, string>>(
    document?.sections ?? {},
  );
  const [state, setState] = useState<DraftState>({});
  const [dirty, setDirty] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const finalized = document?.finalizedAt != null;

  function generate() {
    setConfirmRegen(false);
    startTransition(async () => {
      const result = await generateDocumentsAction(projectId, requestId, tone);
      setState(result);
      if (result.ok) {
        setDirty(false);
        router.refresh();
      }
    });
  }

  function save() {
    if (!document) return;
    startTransition(async () => {
      const result = await saveSectionsAction(projectId, requestId, document.id, sections);
      setState(result);
      if (result.ok) {
        setDirty(false);
        router.refresh();
      }
    });
  }

  function finalize() {
    startTransition(async () => {
      const result = await finalizeAction(projectId, requestId);
      setState(result);
      if (result.ok) router.refresh();
    });
  }

  async function copyReply() {
    // writeText rejects on insecure contexts or denied clipboard permission;
    // fall back to a selectable copy, and say so if even that fails.
    try {
      await navigator.clipboard.writeText(replyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        // globalThis because the `document` prop shadows the DOM global here.
        const scratch = globalThis.document.createElement("textarea");
        scratch.value = replyText;
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        globalThis.document.body.appendChild(scratch);
        scratch.select();
        const ok = globalThis.document.execCommand("copy");
        scratch.remove();
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          return;
        }
      } catch {
        // ignore — the notice below covers it
      }
      setState({ error: "Could not copy automatically — select the reply text and copy it manually." });
    }
  }

  return (
    <div className="space-y-4">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

      {state.warnings?.length || warnings.length ? (
        <Notice tone="warning" title="Check these before sending">
          <ul className="list-disc space-y-1 pl-5">
            {[...(state.warnings ?? []), ...warnings].map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {finalized ? (
        <Notice tone="success" title="This version is finalized">
          <p>
            It is frozen as a snapshot and can be reproduced exactly. To make changes,
            generate a new version — this one stays on record.
          </p>
        </Notice>
      ) : null}

      {!document ? (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Generate a draft reply and change order from your reviewed decisions and your
            estimate.
          </p>
          {canEdit ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <ToneToggle tone={tone} onChange={setTone} disabled={pending} />
              <Button variant="primary" onClick={generate} disabled={pending}>
                {pending ? "Drafting…" : "Generate documents"}
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              The project owner generates and finalizes the documents. You can review the
              previews and, if you have the approver role, sign off below.
            </p>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Editable narrative */}
          <div className="space-y-3">
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Client reply — version {document.version}
                </h2>
                <ToneToggle
                  tone={tone}
                  onChange={setTone}
                  disabled={pending || finalized || !canEdit}
                />
              </div>

              <div className="space-y-3">
                {DRAFT_REPLY_SECTIONS.map((key) => (
                  <SectionEditor
                    key={key}
                    label={SECTION_TITLES[key]}
                    value={sections[key] ?? ""}
                    disabled={finalized || !canEdit}
                    onChange={(value) => {
                      setSections((current) => ({ ...current, [key]: value }));
                      setDirty(true);
                    }}
                  />
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-foreground">
                Change order narrative
              </h2>
              <div className="space-y-3">
                {DRAFT_ORDER_SECTIONS.map((key) => (
                  <SectionEditor
                    key={key}
                    label={SECTION_TITLES[key]}
                    value={sections[key] ?? ""}
                    disabled={finalized || !canEdit}
                    onChange={(value) => {
                      setSections((current) => ({ ...current, [key]: value }));
                      setDirty(true);
                    }}
                  />
                ))}
              </div>
            </Card>

            {!finalized && canEdit ? (
              <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                <p className="text-xs text-muted-foreground">
                  {dirty ? "Unsaved edits" : "All edits saved"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={save} disabled={pending || !dirty}>
                    Save edits
                  </Button>

                  {confirmRegen ? (
                    <>
                      <Button variant="danger" onClick={generate} disabled={pending}>
                        Replace generated text
                      </Button>
                      <Button onClick={() => setConfirmRegen(false)}>Cancel</Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => (document.userEdited ? setConfirmRegen(true) : generate())}
                      disabled={pending}
                    >
                      Regenerate
                    </Button>
                  )}
                </div>

                {confirmRegen ? (
                  <p className="w-full text-xs text-notice-warn-fg">
                    Regenerating writes a new version. Your edits stay on this version and
                    your estimate and decisions are untouched — but the new draft will not
                    contain your wording.
                  </p>
                ) : null}
              </Card>
            ) : null}
          </div>

          {/* Deterministic preview */}
          <div className="space-y-3 lg:sticky lg:top-20 lg:self-start">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <h2 className="text-sm font-semibold text-foreground">Reply to send</h2>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={copyReply}>{copied ? "Copied" : "Copy"}</Button>
                  {/*
                    The credential-free email integration: opens the owner's
                    own Gmail compose window pre-filled. ScopeGuard transmits
                    nothing — the browser navigates, the owner sends. No
                    client email is stored, so the To field is theirs to fill.
                  */}
                  <a
                    href={gmailComposeUrl({
                      to: "",
                      subject: `${rendered.reference} — change order`,
                      body: replyText,
                    })}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Open in Gmail
                  </a>
                </div>
              </div>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-foreground">
                {replyText || "Generate the documents to see the reply."}
              </pre>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <h2 className="text-sm font-semibold text-foreground">Change order</h2>
                <ExportMenu
                  projectId={projectId}
                  requestId={requestId}
                  requestApproved={requestApproved}
                />
              </div>
              <p className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
                Figures and dates are rendered from your records, not from generated text.
              </p>
              <ChangeOrderBody rendered={rendered} />
            </Card>
          </div>
        </div>
      )}

      {document && !finalized && canEdit ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-foreground">Finalize</h2>

          {blockers.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                A draft can carry open questions. A final change order cannot.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {blockers.map((blocker, index) => (
                  <li key={index}>{blocker}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              All items are reviewed and the estimate is complete. Finalizing freezes this
              version as a snapshot you can reproduce later.
            </p>
          )}

          <div className="mt-3">
            <Button
              variant="primary"
              onClick={finalize}
              disabled={pending || blockers.length > 0}
            >
              Finalize change order
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function ToneToggle({
  tone,
  onChange,
  disabled,
}: {
  tone: Tone;
  onChange: (tone: Tone) => void;
  disabled?: boolean;
}) {
  return (
    <Tabs
      value={tone}
      onValueChange={(value) => onChange(value as Tone)}
      // Controlled purely by props — no TabsContent, this is a segmented control.
    >
      <TabsList className="h-8">
        {(["friendly", "formal"] as const).map((option) => (
          <TabsTrigger
            key={option}
            value={option}
            disabled={disabled}
            className="px-2.5 text-xs capitalize"
          >
            {option}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function SectionEditor({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={Math.max(2, Math.ceil(value.length / 70))}
        placeholder="(empty)"
        className={textareaClass}
      />
    </label>
  );
}

/**
 * PDF export controls.
 *
 * Internal review notes are excluded by default and require a deliberate
 * second action to include — the plan is explicit that an export must not
 * carry internal notes unless explicitly selected.
 */
function ExportMenu({
  projectId,
  requestId,
  requestApproved,
}: {
  projectId: string;
  requestId: string;
  requestApproved: boolean;
}) {
  const [showOptions, setShowOptions] = useState(false);
  const base = `/projects/${projectId}/requests/${requestId}/export`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={base}
        // Plain navigation, not fetch: lets the browser handle the download
        // and keeps the session cookie on the request.
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Download PDF
      </a>

      {/*
        The invoice renders the same approved figures the change order
        exported — no payment is taken and nothing is sent. It appears only
        once an approval has been recorded.
      */}
      {requestApproved ? (
        <a
          href={`/projects/${projectId}/requests/${requestId}/invoice`}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Download invoice
        </a>
      ) : null}

      <button
        type="button"
        onClick={() => setShowOptions((value) => !value)}
        aria-expanded={showOptions}
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Options
      </button>

      {showOptions ? (
        <div className="w-full rounded-md border border-border bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            The standard export contains no internal review notes. Include them only for
            your own records — never for a copy you send the client.
          </p>
          <a
            href={`${base}?notes=1`}
            className="mt-1.5 inline-block text-xs font-medium text-primary underline underline-offset-2"
          >
            Download with internal notes
          </a>
        </div>
      ) : null}
    </div>
  );
}

function ChangeOrderBody({ rendered }: { rendered: RenderedChangeOrder }) {
  return (
    <div className="max-h-96 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Reference</dt>
          <dd className="text-foreground">{rendered.reference}</dd>
          <dt className="text-muted-foreground">Prepared</dt>
          <dd className="text-foreground">{rendered.preparedOn}</dd>
          <dt className="text-muted-foreground">Baseline</dt>
          <dd className="text-foreground">{rendered.baselineLabel}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="text-foreground">{rendered.decisionStatus}</dd>
        </dl>

        {rendered.lines.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1 font-medium">Work</th>
                <th className="py-1 text-right font-medium">Hours</th>
                <th className="py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rendered.lines.map((line, index) => (
                <tr key={index} className="border-b border-border last:border-0">
                  <td className="py-1 pr-2">{line.description}</td>
                  <td className="py-1 text-right tabular-nums">{line.hours || "—"}</td>
                  <td className="py-1 text-right tabular-nums">{line.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-medium">
                <td className="py-1.5" colSpan={2}>
                  Total ({rendered.currency})
                </td>
                <td className="py-1.5 text-right tabular-nums">{rendered.subtotal}</td>
              </tr>
            </tfoot>
          </table>
        ) : null}

        {rendered.openQuestions.length > 0 ? (
          <div>
            <p className="text-xs font-semibold text-muted-foreground">
              Open questions
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground">
              {rendered.openQuestions.map((question, index) => (
                <li key={index}>{question}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
  );
}
