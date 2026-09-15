import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth";
import { getProject } from "@/lib/data/projects";
import { PDF_SIZE_LIMIT } from "@/lib/limits";
import { extractPdfText, PdfExtractionError } from "@/lib/pdf/extract";
import { ocrPdf, ocrTranscriptError, OcrError } from "@/lib/pdf/ocr";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * PDF scope upload (plan Feature 3, P1).
 *
 * A route handler rather than a server action because server actions cap
 * request bodies well below the 10 MB the plan allows for a PDF.
 *
 * This endpoint EXTRACTS ONLY. It does not create a scope document, because
 * the plan requires the user to preview the extracted text before processing
 * — and to correct it if extraction garbled anything. The original file is
 * stored in the private bucket FIRST, so the source is preserved even when
 * extraction fails or the user abandons the preview.
 *
 * OCR is an explicit second request (ocr=1), offered only after a first
 * attempt failed with no text layer. Recognition is slow and fallible, so it
 * never runs implicitly. The response carries per-page confidence, and the
 * transcription the user reviews is never committed by this route — that
 * happens in ingestPdfAction, which records the human review.
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
    // Confirms the project exists AND belongs to this user before accepting
    // an upload against it.
    await getProject(user.id, id);
  } catch {
    return NextResponse.json({ error: "That project could not be found." }, { status: 404 });
  }

  let file: File | null;
  let wantsOcr = false;
  let priorStoragePath: string | null = null;
  try {
    const formData = await request.formData();
    const entry = formData.get("file");
    file = entry instanceof File ? entry : null;
    wantsOcr = formData.get("ocr") === "true";
    const prior = formData.get("storagePath");
    // Set on the scan-detected 422 so the OCR retry reuses the already-stored
    // copy instead of uploading the same bytes twice.
    priorStoragePath = typeof prior === "string" && prior.length > 0 ? prior : null;
  } catch {
    return NextResponse.json({ error: "The upload could not be read." }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: "Choose a PDF file to upload." }, { status: 400 });
  }

  // Reject on declared size before reading the body into memory.
  if (file.size > PDF_SIZE_LIMIT) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${PDF_SIZE_LIMIT / 1024 / 1024} MB limit. Upload just the scope section, or paste the text instead.`,
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  /*
   * Store the original in the private bucket, keyed by <uid>/ so the storage
   * policies isolate it. A storage failure must not lose the extraction the
   * user is about to review, so it degrades to a null path rather than an
   * error. The OCR retry reuses the copy stored by the first attempt.
   */
  let storagePath: string | null = priorStoragePath ?? `${user.id}/${id}/${crypto.randomUUID()}.pdf`;

  if (priorStoragePath === null) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.storage
        .from("scope-documents")
        .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });

      if (error) storagePath = null;
    } catch {
      storagePath = null;
    }
  }

  let extracted;
  try {
    extracted = await extractPdfText(bytes, file.name);
  } catch (error) {
    if (error instanceof PdfExtractionError) {
      /*
       * A scan is the one failure that OCR can do something about, so the
       * response says so and the client offers the explicit second attempt.
       * In the OCR request itself, fall through to recognition below rather
       * than erroring — the first attempt already established there is no
       * text layer.
       */
      if (error.kind === "no_text_layer" && !wantsOcr) {
        return NextResponse.json(
          { error: error.message, kind: error.kind, ocrAvailable: true, storagePath },
          { status: 422 },
        );
      }

      if (error.kind !== "no_text_layer") {
        return NextResponse.json(
          { error: error.message, kind: error.kind, retryable: error.retryable },
          { status: 422 },
        );
      }
    } else {
      return NextResponse.json(
        { error: "That PDF could not be processed. Paste the scope text instead." },
        { status: 422 },
      );
    }
  }

  // A text layer survived even though OCR was requested: the normal result is
  // strictly better than a transcription of the same pages.
  if (extracted) {
    return NextResponse.json({
      pages: extracted.pages,
      pageCount: extracted.pageCount,
      emptyPageNumbers: extracted.emptyPageNumbers,
      storagePath,
      fileName: file.name,
    });
  }

  try {
    const result = await ocrPdf(bytes);

    const transcriptError = ocrTranscriptError(result.pages);
    if (transcriptError) {
      return NextResponse.json(
        { error: transcriptError, kind: "ocr_unusable" },
        { status: 422 },
      );
    }

    return NextResponse.json({
      pages: result.pages.map((page) => page.text),
      pageCount: result.pageCount,
      ocr: {
        confidence: result.confidence,
        pageConfidences: result.pages.map((page) => page.confidence),
        lowConfidencePages: result.lowConfidencePages,
        truncated: result.truncated,
        durationMs: result.durationMs,
      },
      storagePath,
      fileName: file.name,
    });
  } catch (error) {
    const message =
      error instanceof OcrError
        ? error.message
        : "Text recognition failed on this scan. Paste the scope text instead.";
    return NextResponse.json({ error: message, kind: "ocr_failed", retryable: true }, {
      status: 422,
    });
  }
}
