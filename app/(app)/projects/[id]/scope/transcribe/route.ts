import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth";
import { getProject } from "@/lib/data/projects";
import { AUDIO_SIZE_LIMIT } from "@/lib/limits";
import { isFixtureMode, transcribeAudio } from "@/lib/ai/provider";
import { createClient } from "@/lib/supabase/server";

/**
 * Audio/video transcription for the transcript scope source (plan §10, P3).
 *
 * Like the PDF upload route, this EXTRACTS ONLY: it turns the recording into
 * timed segments for the review screen. It never creates a scope document —
 * the commit happens in ingestTranscriptAction after the user has reviewed
 * and corrected the transcription, which is what sets transcript_reviewed_at.
 *
 * The machine's transcription is material for a human to check, exactly like
 * OCR output — never a baseline on its own.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (isFixtureMode()) {
    return NextResponse.json(
      {
        error:
          "Audio transcription needs the AI key, which is not configured on this deployment. Paste a Zoom or Meet transcript instead — it works the same way.",
      },
      { status: 503 },
    );
  }

  try {
    // Confirms the project exists AND is visible to this user before
    // accepting an upload against it.
    await getProject(user.id, id);
  } catch {
    return NextResponse.json({ error: "That project could not be found." }, { status: 404 });
  }

  let file: File | null;
  try {
    const formData = await request.formData();
    const entry = formData.get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ error: "The upload could not be read." }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: "Choose an audio or video file to transcribe." }, { status: 400 });
  }

  if (file.size > AUDIO_SIZE_LIMIT) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${AUDIO_SIZE_LIMIT / 1024 / 1024} MB transcription limit. Export just the call, or paste a transcript instead.`,
      },
      { status: 413 },
    );
  }

  const mime = file.type || "";
  if (!/^(audio|video)\//.test(mime)) {
    return NextResponse.json(
      { error: "That file type is not audio or video. Paste a transcript instead." },
      { status: 415 },
    );
  }

  // Store the original recording privately, keyed by <uid>/ so storage
  // policies isolate it. A storage failure must not lose the transcription
  // the user is about to review, so it degrades to a null path.
  let storagePath: string | null = `${user.id}/${id}/${crypto.randomUUID()}`;
  try {
    const supabase = await createClient();
    const { error } = await supabase.storage
      .from("scope-documents")
      .upload(storagePath, new Uint8Array(await file.arrayBuffer()), {
        contentType: mime,
        upsert: false,
      });
    if (error) storagePath = null;
  } catch {
    storagePath = null;
  }

  try {
    const result = await transcribeAudio(file);
    return NextResponse.json({
      cues: result.segments,
      language: result.language,
      durationSec: result.durationSec,
      model: result.model,
      storagePath,
      fileName: file.name,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? `Transcription failed: ${error.message}`
        : "Transcription failed on this recording. Try again, or paste a transcript instead.";
    return NextResponse.json({ error: message, retryable: true }, { status: 422 });
  }
}
