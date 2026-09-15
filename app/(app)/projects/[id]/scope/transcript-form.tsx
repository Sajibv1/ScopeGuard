"use client";

import { useRef, useState, useTransition } from "react";

import { ingestTranscriptAction } from "./actions";
import { Button, Card, Field, Notice, inputClass, textareaClass } from "@/components/ui";
import { AUDIO_SIZE_LIMIT } from "@/lib/limits";
import {
  formatTimestamp,
  parseTranscript,
  type TranscriptCue,
} from "@/lib/transcript/parse";

type Mode = "paste" | "audio";

/**
 * Transcript intake (plan §10, Tier 1) — two ways in, one review step.
 *
 * A call is a real scope source, but it is not a contract, so the flow earns
 * its place in the same pipeline as paste and PDF:
 *
 *  1. Get timed cues — parsed from a pasted Zoom/Meet/WebVTT/SRT transcript,
 *     or transcribed from an uploaded recording.
 *  2. The user REVIEWs the transcription on screen, cue by cue, fixing the
 *     names and terms machines get wrong. This review is the gate: the commit
 *     records it, and the database refuses a transcript document without it.
 *  3. Extraction runs in transcript mode, where a verified quote proves
 *     something was SAID and a separate commitment label records how firmly
 *     the client committed. Only the user's confirmation makes any of it
 *     baseline.
 */
export function TranscriptIntakeForm({ projectId }: { projectId: string }) {
  const [mode, setMode] = useState<Mode>("paste");
  const [cues, setCues] = useState<TranscriptCue[] | null>(null);
  const [title, setTitle] = useState("Kickoff call");
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setCues(null);
    setStoragePath(null);
    setError(null);
    setActionError(null);
    setPaste("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function parsePasted() {
    const parsed = parseTranscript(paste);
    if (!parsed) {
      setError(
        "No timed cues were found. Transcript mode needs a Zoom, Meet, WebVTT or SRT export with timestamps — for plain text, use the paste tab.",
      );
      return;
    }
    setError(null);
    setCues(parsed);
  }

  async function transcribe(file: File) {
    setError(null);
    setTranscribing(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/projects/${projectId}/scope/transcribe`, {
        method: "POST",
        body,
      });
      const result = (await response.json()) as {
        cues?: TranscriptCue[];
        storagePath?: string | null;
        error?: string;
      };
      if (!response.ok || !result.cues) {
        setError(result.error ?? "Transcription failed. Try again, or paste a transcript instead.");
        return;
      }
      setStoragePath(result.storagePath ?? null);
      setCues(result.cues);
    } catch {
      setError("The transcription request did not go out. Check your connection and try again.");
    } finally {
      setTranscribing(false);
    }
  }

  function updateCue(index: number, text: string) {
    setCues((current) =>
      current ? current.map((cue, i) => (i === index ? { ...cue, text } : cue)) : current,
    );
  }

  function removeCue(index: number) {
    setCues((current) => (current ? current.filter((_, i) => i !== index) : current));
  }

  function commit() {
    if (!cues) return;
    startTransition(async () => {
      const result = await ingestTranscriptAction(projectId, {
        title,
        cues,
        storagePath,
      });
      if (result.ok) {
        window.location.reload();
        return;
      }
      setActionError(result.error ?? "The transcript could not be saved.");
    });
  }

  // ── Step 1: get timed cues ────────────────────────────────────────────────
  if (!cues) {
    return (
      <div className="space-y-4">
        <Notice tone="info" title="A call transcript is a scope source — with one difference">
          <p>
            Everything extracted from it is labelled as coming from a reviewed transcript, never as
            contract text, and each item records how firmly the client committed in the call.
          </p>
        </Notice>

        {/* Toggle buttons, not a tablist: two plain buttons expose their
            pressed state directly, which is what screen readers expect from
            this control — a role="tablist" whose children are not real tabs
            announces a structure that does not exist. */}
        <div className="flex gap-2">
          <Button
            type="button"
            aria-pressed={mode === "paste"}
            variant={mode === "paste" ? "primary" : "secondary"}
            onClick={() => setMode("paste")}
          >
            Paste transcript
          </Button>
          <Button
            type="button"
            aria-pressed={mode === "audio"}
            variant={mode === "audio" ? "primary" : "secondary"}
            onClick={() => setMode("audio")}
          >
            Upload a recording
          </Button>
        </div>

        {mode === "paste" ? (
          <div className="space-y-4">
            <Field
              label="Call title"
              hint="Names the call on every evidence surface, e.g. 'Kickoff call — Oct 3'."
            >
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={inputClass}
                placeholder="Kickoff call — Oct 3"
              />
            </Field>
            <Field
              label="Transcript (WebVTT or SRT)"
              required
              hint="Zoom and Meet both export these — with timestamps, which become the evidence locators."
            >
              <textarea
                value={paste}
                onChange={(event) => setPaste(event.target.value)}
                rows={12}
                className={`${textareaClass} font-mono text-xs`}
                placeholder={"WEBVTT\n\n00:00:05.000 --> 00:00:09.000\nClient: We'll need the site in English and German."}
              />
            </Field>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button variant="primary" disabled={paste.trim().length === 0} onClick={parsePasted}>
              Review transcript
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Field
              label="Call title"
              hint="Names the call on every evidence surface, e.g. 'Kickoff call — Oct 3'."
            >
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={inputClass}
                placeholder="Kickoff call — Oct 3"
              />
            </Field>
            <Field
              label="Audio or video file"
              required
              hint={`Up to ${AUDIO_SIZE_LIMIT / 1024 / 1024} MB. The recording is transcribed, then you review it before anything is saved.`}
            >
              {/*
                The native file input is sr-only: styled with inputClass it
                renders as a flat OS control that does not read as clickable.
                The visible Button matches the picker on the request-capture
                step; the label text still opens it (the input is the label's
                first labelable control).
              */}
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="audio/*,video/*"
                  disabled={transcribing}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void transcribe(file);
                  }}
                  className="sr-only"
                />
                <Button
                  type="button"
                  variant="primary"
                  disabled={transcribing}
                  onClick={() => fileInput.current?.click()}
                >
                  {transcribing ? "Transcribing…" : "Choose a file"}
                </Button>
              </>
            </Field>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            {transcribing ? (
              <p className="text-sm text-muted-foreground">
                Transcribing… this can take a minute for a long call.
              </p>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  // ── Step 2: review the transcription, then commit ─────────────────────────
  return (
    <div className="space-y-4">
      <Notice tone="warning" title="Review the transcription before it becomes a scope document">
        <p>
          Machines mishear names, products and terms. Fix anything wrong here — this review is
          recorded, and evidence from this call will always be labelled as a reviewed transcript,
          not as contract text.
        </p>
      </Notice>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">
              {cues.length} cue{cues.length === 1 ? "" : "s"} · ends{" "}
              {formatTimestamp(cues.at(-1)?.endSec ?? 0)} into the call
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={reset} disabled={pending}>
            Start over
          </Button>
        </div>
      </Card>

      <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
        {cues.map((cue, index) => (
          <div key={index} className="flex items-start gap-2">
            <span className="w-16 shrink-0 pt-2 font-mono text-xs text-muted-foreground">
              {formatTimestamp(cue.startSec)}
            </span>
            <textarea
              value={cue.text}
              onChange={(event) => updateCue(index, event.target.value)}
              rows={Math.min(4, Math.max(1, Math.ceil(cue.text.length / 60)))}
              className={`${textareaClass} text-sm`}
            />
            <button
              type="button"
              onClick={() => removeCue(index)}
              className="pt-2 text-xs text-destructive hover:underline"
              aria-label={`Remove cue at ${formatTimestamp(cue.startSec)}`}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={commit} disabled={pending || cues.length === 0}>
          {pending ? "Extracting scope…" : "Confirm and extract scope"}
        </Button>
        <p className="text-xs text-muted-foreground">
          The transcript is saved before analysis starts, so nothing is lost if extraction fails.
        </p>
      </div>
    </div>
  );
}
