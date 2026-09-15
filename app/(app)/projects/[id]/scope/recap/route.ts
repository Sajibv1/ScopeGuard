import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth";
import { getProject, getScopeState } from "@/lib/data/projects";
import { recordEvent } from "@/lib/data/requests";
import { renderScopeRecap } from "@/lib/documents/recap";
import { renderRecapPdf } from "@/lib/pdf/recap";

/**
 * Scope recap PDF export (plan §10, Tier 2).
 *
 * Only a notes baseline (source_kind 'recap') has anything to recap — for
 * any other source this route is a 404, because a recap of a written
 * agreement would be a different (and misleading) document. The PDF states
 * its author's position plainly: this is a recollection awaiting the
 * client's confirmation, not an agreement.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  try {
    const [project, scope] = await Promise.all([
      getProject(user.id, id),
      getScopeState(user.id, id),
    ]);

    if (!scope.document || scope.document.sourceKind !== "recap") {
      return NextResponse.json(
        { error: "There are no call notes to recap. A recap exists only for a notes baseline." },
        { status: 404 },
      );
    }

    const activeVersion = scope.draft ?? scope.confirmed!;
    const rendered = renderScopeRecap({
      project,
      document: scope.document,
      items: scope.items,
      preparedOn: new Date().toISOString(),
    });

    const pdf = await renderRecapPdf(rendered);

    await recordEvent(user.id, {
      projectId: id,
      event: "Scope recap exported",
      note: "Recap PDF generated from call notes. It becomes an agreement only when the client replies to confirm.",
    });

    const safeName = `scope-recap-${project.name}`
      .replace(/[^a-z0-9\-_ ]/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80);

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}.pdf"`,
        // The recap embeds the user's own notes; keep it out of shared caches.
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not build the recap." }, { status: 500 });
  }
}
