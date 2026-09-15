import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth";
import { getProject, getScopeDocument, getScopeVersion, listScopeItems } from "@/lib/data/projects";
import {
  getChangeRequest,
  getLatestDocument,
  getReviewableItems,
  listEstimateItems,
} from "@/lib/data/requests";
import { renderChangeOrder } from "@/lib/documents/render";
import { renderChangeOrderPdf } from "@/lib/pdf/change-order";

/**
 * Change-order PDF export (plan Feature 9, P1).
 *
 * A finalized request exports its frozen SNAPSHOT; a draft exports what it
 * currently says, watermarked as a draft by its status line. That distinction
 * matters: editing a draft must never change what a previously sent document
 * said (plan §10).
 *
 * Internal review notes are excluded unless ?notes=1 is passed explicitly.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const { id, requestId } = await params;

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const includeInternalNotes = request.nextUrl.searchParams.get("notes") === "1";

  try {
    // Every read is owner-scoped and RLS-enforced; another user's id here
    // returns not-found rather than a document.
    const [project, changeRequest] = await Promise.all([
      getProject(user.id, id),
      getChangeRequest(user.id, requestId),
    ]);

    const [scopeVersion, items, estimateItems, document] = await Promise.all([
      getScopeVersion(user.id, changeRequest.scopeVersionId),
      getReviewableItems(user.id, requestId),
      listEstimateItems(user.id, requestId),
      getLatestDocument(user.id, requestId, "client_reply"),
    ]);

    // An OCR baseline is labelled as a transcription on the export too —
    // the reader deciding whether to sign must be able to tell.
    const scopeDocument = await getScopeDocument(user.id, scopeVersion.documentId);
    // So is a baseline that still contains unconfirmed memory (§10 Tier 2).
    const scopeItems = await listScopeItems(user.id, scopeVersion.id);

    /*
     * A finalized document carries the exact structure that was frozen at
     * finalization. Re-rendering from live records could differ if anything
     * changed since, so the snapshot wins when it exists.
     */
    const rendered =
      document?.finalizedAt && document.snapshot
        ? (document.snapshot as ReturnType<typeof renderChangeOrder>)
        : renderChangeOrder({
            project,
            request: changeRequest,
            scopeVersion,
            items,
            estimateItems,
            document,
            includeInternalNotes,
            sourceIsTranscribed: scopeDocument.ocrApplied,
            sourceIsTranscript: scopeDocument.transcriptApplied,
            baselineIncludesMemory: scopeItems.some((item) => item.provenance === "memory"),
          });

    const pdf = await renderChangeOrderPdf({
      rendered,
      sections: document?.sections ?? {},
      includeInternalNotes,
    });

    const safeName = `${changeRequest.reference}-${project.name}`
      .replace(/[^a-z0-9\-_ ]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80);

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName || "change-order"}.pdf"`,
        "Content-Length": String(pdf.byteLength),
        // Contains client-confidential material: never cache in a shared proxy.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate the PDF.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
