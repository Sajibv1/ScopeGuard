import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth";
import { getProject } from "@/lib/data/projects";
import { AUDIO_SIZE_LIMIT, IMAGE_SIZE_LIMIT } from "@/lib/limits";
import { isFixtureMode, transcribeAudio } from "@/lib/ai/provider";
import { ocrScreenshot, screenshotTextError, ScreenshotOcrError } from "@/lib/ocr/screenshot";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * Request capture from a voice note, a video, or a screenshot.
 *
 * This endpoint EXTRACTS ONLY, exactly like the scope-side upload and
 * transcribe routes: it turns the file into text and hands it back for
 * review. The client message it produces is what assessments quote as the
 * client's own words, so a machine transcription or recognition pass is
 * never submitted sight-unseen — the capture form shows the text in the
 * message box itself, the user reads and fixes it, and only the submit
 * creates the change request.
 *
 * Audio and video go to the transcription model; screenshots are recognised
 * locally and work without an AI key. The original file is stored privately
 * first, so the source is preserved even when extraction fails or the user
 * abandons the form.
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
    return NextResponse.json(
      { error: "Choose a voice note, a video, or a screenshot to capture the request from." },
      { status: 400 },
    );
  }

  const mime = file.type || "";
  const isRecording = /^(audio|video)\//.test(mime);
  const isImage = /^image\//.test(mime);

  if (!isRecording && !isImage) {
    return NextResponse.json(
      { error: "That file type is not supported. Upload audio, video, or an image — or paste the message instead." },
      { status: 415 },
    );
  }

  if (isRecording && isFixtureMode()) {
    return NextResponse.json(
      {
        error:
          "Voice and video transcription needs the AI key, which is not configured on this deployment. A screenshot is read on this server, or paste the message instead.",
      },
      { status: 503 },
    );
  }

  const sizeLimit = isRecording ? AUDIO_SIZE_LIMIT : IMAGE_SIZE_LIMIT;
  if (file.size > sizeLimit) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${sizeLimit / 1024 / 1024} MB limit. ${
          isRecording
            ? "Export just the part where the client asks, or paste the message instead."
            : "Take a tighter screenshot of the message, or paste it instead."
        }`,
      },
      { status: 413 },
    );
  }

  // Store the original privately, keyed by <uid>/ so storage policies
  // isolate it. A storage failure must not lose the text the user is about
  // to review, so it degrades to a null path.
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

  // ── Voice note or video: transcribe ───────────────────────────────────────
  if (isRecording) {
    try {
      const result = await transcribeAudio(file);

      if (result.segments.length === 0) {
        return NextResponse.json(
          {
            error:
              "No speech was recognised in this recording. Check the file plays, or paste the message instead.",
            retryable: true,
          },
          { status: 422 },
        );
      }

      return NextResponse.json({
        kind: "transcript",
        // A client message has no timestamps to preserve — the segments join
        // into the message the user then reviews as a whole.
        text: result.segments.map((segment) => segment.text).join(" "),
        durationSec: result.durationSec,
        model: result.model,
        storagePath,
        fileName: file.name,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? `Transcription failed: ${error.message}`
          : "Transcription failed on this recording. Try again, or paste the message instead.";
      return NextResponse.json({ error: message, retryable: true }, { status: 422 });
    }
  }

  // ── Screenshot: recognise ─────────────────────────────────────────────────
  try {
    const result = await ocrScreenshot(new Uint8Array(await file.arrayBuffer()));

    const problem = screenshotTextError(result.text);
    if (problem) {
      return NextResponse.json({ error: problem, retryable: true }, { status: 422 });
    }

    return NextResponse.json({
      kind: "ocr",
      text: result.text,
      confidence: result.confidence,
      storagePath,
      fileName: file.name,
    });
  } catch (error) {
    const message =
      error instanceof ScreenshotOcrError
        ? error.message
        : "Text recognition failed on this screenshot. Take a tighter one, or paste the message instead.";
    return NextResponse.json({ error: message, retryable: true }, { status: 422 });
  }
}
