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
import { renderInvoicePdf } from "@/lib/pdf/invoice";

/**
 * Invoice PDF export (§8 "invoice creation", honest version).
 *
 * Only an APPROVED change request can be invoiced — the invoice cites the
 * recorded approval, which is what the user was told, never a verified
 * signature (plan §10). No payment is taken, nothing is sent, and the totals
 * are the same deterministic values the change order exported.
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

  try {
    const [project, changeRequest] = await Promise.all([
      getProject(user.id, id),
      getChangeRequest(user.id, requestId),
    ]);

    if (changeRequest.status !== "approved") {
      return NextResponse.json(
        { error: "Invoices are only available for approved change requests." },
        { status: 409 },
      );
    }

    const [scopeVersion, items, estimateItems, document] = await Promise.all([
      getScopeVersion(user.id, changeRequest.scopeVersionId),
      getReviewableItems(user.id, requestId),
      listEstimateItems(user.id, requestId),
      getLatestDocument(user.id, requestId, "client_reply"),
    ]);

    // An approved request should have a finalized document; its frozen
    // snapshot is the record of what was actually agreed. If finalization was
    // skipped, render from live records so the invoice still matches the
    // estimate exactly.
    const scopeDocument = await getScopeDocument(user.id, scopeVersion.documentId);
    const scopeItems = await listScopeItems(user.id, scopeVersion.id);

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
            sourceIsTranscribed: scopeDocument.ocrApplied,
            sourceIsTranscript: scopeDocument.transcriptApplied,
            baselineIncludesMemory: scopeItems.some((item) => item.provenance === "memory"),
          });

    if (!rendered.hasEstimate) {
      return NextResponse.json(
        { error: "This change request has no estimate to invoice." },
        { status: 409 },
      );
    }

    const pdf = await renderInvoicePdf(rendered);

    const safeName = `invoice-${changeRequest.reference}-${project.name}`
      .replace(/[^a-z0-9\-_ ]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80);

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName || "invoice"}.pdf"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate the invoice.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
