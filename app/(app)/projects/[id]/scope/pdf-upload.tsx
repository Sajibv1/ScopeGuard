"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ingestPdfAction } from "./actions";
import { Button, Card, Field, Notice, inputClass, textareaClass } from "@/components/ui";
import { PDF_SIZE_LIMIT } from "@/lib/limits";

interface Extraction {
  pages: string[];
  pageCount: number;
  emptyPageNumbers: number[];
  storagePath: string | null;
  fileName: string;
  ocr?: OcrInfo;
}

/**
 * What the recognition pass reported. `machineText` is the machine's own
 * output, kept SEPARATE from the editable pages — user corrections must not
 * overwrite the audit record of what OCR actually produced.
 */
interface OcrInfo {
  confidence: number;
  pageConfidences: number[];
  lowConfidencePages: number[];
  truncated: boolean;
  machineText: string[];
}

/**
 * PDF upload with a preview step (plan Feature 3, P1).
 *
 * The plan requires the extracted text to be shown BEFORE processing, and
 * requires garbled text to be corrected rather than accepted. So this is two
 * steps: upload and extract, then review page by page and confirm.
 *
 * Editing happens per page rather than in one box because page boundaries
 * become evidence locators — keeping them separate means an edit on page 2
 * cannot shift where page 5 starts.
 *
 * A scanned PDF gets a third path: text recognition, run only when the user
 * asks for it, and its result is treated as a TRANSCRIPTION the user must
 * read and correct before it can become a baseline. That review is not a
 * courtesy — the server records it, and the database refuses an OCR document
 * without it.
 */
export function PdfUploadForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [scanRejected, setScanRejected] = useState(false);
  const [scanStoragePath, setScanStoragePath] = useState<string | null>(null);
  const [transcriptionReviewed, setTranscriptionReviewed] = useState(false);
  const [title, setTitle] = useState("Statement of work");
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload(file: File, ocr = false) {
    setError(null);
    setUploading(true);
    setScanRejected(false);

    try {
      const body = new FormData();
      body.set("file", file);
      if (ocr) {
        body.set("ocr", "true");
        // Reuse the copy the first attempt already stored.
        if (scanStoragePath) body.set("storagePath", scanStoragePath);
      }

      const response = await fetch(`/projects/${projectId}/scope/upload`, {
        method: "POST",
        body,
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "That file could not be processed.");
        // The one failure recognition can rescue. The file is kept so the
        // retry does not make the user re-choose it.
        if (data.ocrAvailable) {
          setFile(file);
          setScanStoragePath(typeof data.storagePath === "string" ? data.storagePath : null);
          setScanRejected(true);
        }
        return;
      }

      const result = data as Extraction;
      setExtraction(result);
      setFile(file);
      setPages(result.pages);
      setTitle(file.name.replace(/\.pdf$/i, "") || "Statement of work");
    } catch {
      setError("The upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  function confirm() {
    if (!extraction) return;
    const ocr = extraction.ocr;

    startTransition(async () => {
      const result = await ingestPdfAction(projectId, {
        title,
        pages,
        storagePath: extraction.storagePath,
        // Passing this is the attestation that the transcription was read
        // and corrected. The checkbox gates the button below.
        ...(ocr
          ? {
              ocr: {
                confidence: ocr.confidence,
                machinePages: ocr.machineText.map((text, index) => ({
                  page: index + 1,
                  text,
                  confidence: ocr.pageConfidences[index] ?? 0,
                  characters: text.length,
                })),
              },
            }
          : {}),
      });

      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  // ── Step 1: choose a file ────────────────────────────────────────────────
  if (!extraction) {
    return (
      <div className="space-y-4">
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = event.dataTransfer.files[0];
            if (dropped) void upload(dropped);
          }}
          className="rounded-lg border border-dashed border-input bg-muted/40 px-6 py-10 text-center transition-colors hover:border-primary/50"
        >
          <p className="text-sm font-medium text-foreground">
            Drop a PDF here, or choose a file
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Up to {PDF_SIZE_LIMIT / 1024 / 1024} MB. Text-based PDFs are read directly; scanned
            documents can be run through text recognition, which you review before it becomes
            the baseline.
          </p>

          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void upload(chosen);
            }}
          />

          <div className="mt-4">
            <Button
              type="button"
              variant="primary"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? "Extracting text…" : "Choose a PDF"}
            </Button>
          </div>
        </div>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {scanRejected && file ? (
          <Card className="p-4">
            <h3 className="text-sm font-medium text-foreground">It looks like a scan</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              There is no text layer to extract. Recognition is approximate — every page comes
              back with a confidence score, and nothing is committed until you have read and
              corrected the transcription. Recognition can take around a minute for long scans.
            </p>
            <div className="mt-3">
              <Button
                variant="primary"
                disabled={uploading}
                onClick={() => void upload(file, true)}
              >
                {uploading ? "Recognising text…" : "Run text recognition"}
              </Button>
            </div>
          </Card>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Your file is stored privately and is never placed in a public bucket.
        </p>
      </div>
    );
  }

  // ── Step 2: review the extracted text ────────────────────────────────────
  const ocr = extraction.ocr;
  const characterCount = pages.join("\n\n").length;

  return (
    <div className="space-y-4">
      {ocr ? (
        <Notice
          tone={ocr.confidence >= 90 ? "warning" : "danger"}
          title={`Transcribed by text recognition · ${ocr.confidence.toFixed(1)}% mean confidence`}
        >
          <p>
            This text was recognised from an image of the document, not read from the file
            itself. Recognition makes mistakes — a wrong word here would be quoted as though
            the agreement said it. Read every page against your original and fix anything
            that is off, especially the page
            {ocr.lowConfidencePages.length === 1 ? " " : "s "}
            flagged below.
          </p>
          {ocr.truncated ? (
            <p className="mt-1.5 font-medium">
              Only the first {pages.length} of {extraction.pageCount} pages were recognised.
              If scope terms sit on a later page, paste them in by hand.
            </p>
          ) : null}
        </Notice>
      ) : (
        <Notice tone="info" title={`Extracted ${extraction.pageCount} page${extraction.pageCount === 1 ? "" : "s"} from ${extraction.fileName}`}>
          <p>
            Check the text below before continuing — this is what assessments will quote from.
            Fix anything the PDF mangled. Page breaks become the citation locators, so keep the
            text on the page it came from.
          </p>
        </Notice>
      )}

      {!ocr && extraction.emptyPageNumbers.length > 0 ? (
        <Notice tone="warning" title="Some pages had no selectable text">
          <p>
            Page{extraction.emptyPageNumbers.length === 1 ? " " : "s "}
            {extraction.emptyPageNumbers.join(", ")} came back empty, which usually means
            {extraction.emptyPageNumbers.length === 1 ? " it is" : " they are"} scanned
            images. If those pages contain scope terms, paste them in by hand.
          </p>
        </Notice>
      ) : null}

      <Field label="Document title" hint="Shown on exports and in the source viewer.">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="space-y-3">
        {pages.map((page, index) => {
          const confidence = ocr?.pageConfidences[index];
          const low = ocr?.lowConfidencePages.includes(index + 1) ?? false;

          return (
            <div key={index}>
              <label className="mb-1 flex items-baseline justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Page {index + 1}
                </span>
                {confidence !== undefined ? (
                  <span
                    className={`text-xs font-medium ${low ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {confidence.toFixed(1)}% recognised
                    {low ? " — check this page carefully" : ""}
                  </span>
                ) : page.trim().length === 0 ? (
                  <span className="text-xs text-notice-warn-fg">No text found</span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {page.length.toLocaleString()} characters
                  </span>
                )}
              </label>
              <textarea
                value={page}
                rows={Math.min(14, Math.max(3, Math.ceil(page.length / 90)))}
                onChange={(event) =>
                  setPages((current) =>
                    current.map((value, i) => (i === index ? event.target.value : value)),
                  )
                }
                className={`${textareaClass} font-serif text-[13px]`}
                placeholder="This page had no selectable text. Paste it here if it contains scope terms."
              />
            </div>
          );
        })}
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {ocr ? (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-muted/40 px-3.5 py-3">
          <input
            type="checkbox"
            checked={transcriptionReviewed}
            onChange={(event) => setTranscriptionReviewed(event.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="text-xs leading-relaxed text-foreground">
            I have compared this transcription against the original document and corrected
            errors. I understand assessments and exports will quote from this text, and that
            it will be labelled as a machine transcription.
          </span>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          variant="primary"
          onClick={confirm}
          disabled={pending || (ocr !== undefined && !transcriptionReviewed)}
        >
          {pending
            ? "Extracting scope items…"
            : ocr
              ? "Reviewed — use this transcription"
              : "Looks right — extract scope"}
        </Button>
        <Button
          onClick={() => {
            setExtraction(null);
            setPages([]);
            setError(null);
            setTranscriptionReviewed(false);
          }}
          disabled={pending}
        >
          Choose a different file
        </Button>
        <p className="text-xs text-muted-foreground">
          {characterCount.toLocaleString()} characters total
        </p>
      </div>
    </div>
  );
}
