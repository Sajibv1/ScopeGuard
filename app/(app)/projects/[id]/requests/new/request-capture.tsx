"use client";

import { useRef, useState } from "react";

import { RequestForm } from "./request-form";
import { Button, Notice } from "@/components/ui";
import { AUDIO_SIZE_LIMIT, IMAGE_SIZE_LIMIT } from "@/lib/limits";

/** What the extraction endpoint returned, plus how to label the source. */
interface Capture {
  kind: "transcript" | "ocr";
  text: string;
  fileName: string;
  sourceLabel: "voice_note" | "video" | "screenshot";
  durationSec?: number;
  model?: string;
  confidence?: number;
}

/**
 * Request capture from a voice note, a video, or a screenshot.
 *
 * Two steps, mirroring the scope-side intake: the file is extracted
 * server-side (transcribed for recordings, recognised for screenshots), then
 * the result is placed in the message box itself — which IS the review step.
 * Assessments quote the client message as the client's own words, so a
 * machine's transcription is never submitted sight-unseen: the user reads it,
 * fixes what the machine got wrong, and the submit is theirs.
 */
export function RequestCaptureForm({
  projectId,
  modelLabel,
  transcriptionAvailable,
}: {
  projectId: string;
  modelLabel: string;
  transcriptionAvailable: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  async function extract(file: File) {
    setError(null);
    setExtracting(true);

    try {
      const body = new FormData();
      body.set("file", file);

      const response = await fetch(`/projects/${projectId}/requests/extract`, {
        method: "POST",
        body,
      });

      const data = await response.json();

      if (!response.ok || typeof data.text !== "string") {
        setError(data.error ?? "That file could not be read. Try again, or paste the message instead.");
        return;
      }

      const sourceLabel: Capture["sourceLabel"] =
        data.kind === "transcript"
          ? file.type.startsWith("video/")
            ? "video"
            : "voice_note"
          : "screenshot";

      setCapture({
        kind: data.kind,
        text: data.text,
        fileName: file.name,
        sourceLabel,
        durationSec: typeof data.durationSec === "number" ? data.durationSec : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
        confidence: typeof data.confidence === "number" ? data.confidence : undefined,
      });
    } catch {
      setError("The upload failed. Check your connection and try again.");
    } finally {
      setExtracting(false);
    }
  }

  function reset() {
    setCapture(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  // ── Step 1: choose a file ────────────────────────────────────────────────
  if (!capture) {
    return (
      <div className="space-y-4">
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (extracting) return; // a second drop would race the first extraction
            const dropped = event.dataTransfer.files[0];
            if (dropped) void extract(dropped);
          }}
          className="rounded-lg border border-dashed border-input bg-muted/40 px-6 py-10 text-center transition-colors hover:border-primary/50"
        >
          <p className="text-sm font-medium text-foreground">
            Drop a voice note, a video, or a screenshot — or choose a file
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Recordings up to {AUDIO_SIZE_LIMIT / 1024 / 1024} MB are transcribed; screenshots up
            to {IMAGE_SIZE_LIMIT / 1024 / 1024} MB are read by text recognition. The text comes
            back here for you to check before anything is analysed.
          </p>

          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/*,image/*"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void extract(chosen);
            }}
          />

          <div className="mt-4">
            <Button
              type="button"
              variant="primary"
              disabled={extracting}
              onClick={() => fileInput.current?.click()}
            >
              {extracting ? "Reading the file…" : "Choose a file"}
            </Button>
          </div>
        </div>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {!transcriptionAvailable ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Voice and video transcription needs the AI key, which is not configured on this
            deployment. Screenshots are read on this server, and pasting the message always works.
          </p>
        ) : null}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Your file is stored privately and is never placed in a public bucket.
        </p>
      </div>
    );
  }

  // ── Step 2: review the extracted text in the message box, then submit ────
  return (
    <div className="space-y-4">
      {capture.kind === "transcript" ? (
        <Notice
          tone="warning"
          title={`Transcribed from ${capture.fileName}${
            capture.durationSec ? ` · ${Math.round(capture.durationSec)}s of speech` : ""
          }`}
        >
          <p>
            This is a machine transcription — machines mishear names, numbers and terms. Read the
            message below and fix anything wrong: assessments quote this text as your client&rsquo;s
            own words.
          </p>
        </Notice>
      ) : (
        <Notice
          tone={capture.confidence !== undefined && capture.confidence < 85 ? "danger" : "warning"}
          title={
            capture.confidence !== undefined
              ? `Read from ${capture.fileName} by text recognition · ${capture.confidence.toFixed(1)}% confidence`
              : `Read from ${capture.fileName} by text recognition`
          }
        >
          <p>
            This text was recognised from an image, not read from a file. Recognition mistakes
            become quotes — a wrong number here would be assessed as though the client wrote it.
            Check it against the original and fix anything that is off.
          </p>
        </Notice>
      )}

      {/* Keyed by file so choosing another file starts a fresh form — and a
          fresh idempotency key, which the form generates on mount. */}
      <RequestForm
        key={capture.fileName}
        projectId={projectId}
        modelLabel={modelLabel}
        initialMessage={capture.text}
        defaultSourceLabel={capture.sourceLabel}
      />

      <Button type="button" variant="secondary" onClick={reset}>
        Use a different file
      </Button>
    </div>
  );
}
