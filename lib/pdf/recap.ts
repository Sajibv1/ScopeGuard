/**
 * Scope recap PDF (plan §10, Tier 2).
 *
 * Lays out the deterministic structure from lib/documents/recap.ts. As with
 * the change order: text is drawn as text, and nothing here decides wording —
 * the renderer already fixed every sentence from stored records.
 */

import "server-only";

import PDFDocument from "pdfkit";

import type { RenderedRecap } from "../documents/recap";

const PAGE_MARGIN = 56;
const INK = "#191d24";
const MUTED = "#5b6678";
const RULE = "#d6dae2";

const BODY = "Helvetica";
const BOLD = "Helvetica-Bold";
const ITALIC = "Helvetica-Oblique";

export function renderRecapPdf(rendered: RenderedRecap): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE_MARGIN,
      // Required for the footer pass: switchToPage() can only revisit pages
      // that are still buffered.
      bufferPages: true,
      info: {
        Title: `Scope recap — ${rendered.projectName}`,
        Author: "ScopeGuard",
        Subject: "Scope recap awaiting client confirmation",
        Creator: "ScopeGuard",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      draw(doc, rendered);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

type Doc = InstanceType<typeof PDFDocument>;

function draw(doc: Doc, rendered: RenderedRecap) {
  const width = doc.page.width - PAGE_MARGIN * 2;

  // ── Header ────────────────────────────────────────────────────────────────
  doc.font(BOLD).fontSize(18).fillColor(INK).text("Scope recap");
  doc.font(BODY).fontSize(10).fillColor(MUTED).text(rendered.projectName);

  doc.moveDown(0.8);
  rule(doc, width);
  doc.moveDown(0.8);

  // ── Facts ─────────────────────────────────────────────────────────────────
  const facts: Array<[string, string]> = [
    ["Prepared", rendered.preparedOn],
    ["Recapping", rendered.callDate ?? "A recent call"],
    ["Participants", rendered.participants ?? "—"],
    ["Client", rendered.clientName ?? "—"],
    ["Status", "Awaiting your confirmation"],
  ];

  const labelWidth = 100;
  for (const [label, value] of facts) {
    const y = doc.y;
    doc.font(BODY).fontSize(9).fillColor(MUTED).text(label, PAGE_MARGIN, y, { width: labelWidth });
    doc
      .font(BODY)
      .fontSize(9)
      .fillColor(INK)
      .text(value, PAGE_MARGIN + labelWidth, y, { width: width - labelWidth });
    doc.moveDown(0.25);
  }

  doc.moveDown(0.8);

  // ── Intro ─────────────────────────────────────────────────────────────────
  doc.font(BODY).fontSize(9.5).fillColor(INK).text(rendered.intro, { width });
  doc.moveDown(0.8);

  // ── What I understood ─────────────────────────────────────────────────────
  if (rendered.items.length > 0) {
    heading(doc, "What I understood");

    for (const item of rendered.items) {
      if (doc.y > doc.page.height - 140) doc.addPage();

      doc.moveDown(0.2);
      const y = doc.y;
      doc.font(BODY).fontSize(8.5).fillColor(MUTED).text(item.categoryLabel, PAGE_MARGIN, y, {
        width,
      });
      doc.font(BODY).fontSize(10).fillColor(INK).text(item.description, { width });
    }

    doc.moveDown(0.6);
  }

  // ── Closing ───────────────────────────────────────────────────────────────
  doc.font(ITALIC).fontSize(9.5).fillColor(MUTED).text(rendered.closing, { width });

  // ── Footer: page numbers on every page ────────────────────────────────────
  const bottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font(BODY).fontSize(8).fillColor(MUTED).text(
      `Scope recap · ${rendered.projectName} · page ${i + 1} of ${range.count}`,
      PAGE_MARGIN,
      doc.page.height - 30,
      { width, align: "center" },
    );
  }

  doc.page.margins.bottom = bottomMargin;
}

function heading(doc: Doc, text: string) {
  doc.moveDown(0.3);
  doc.font(BOLD).fontSize(11).fillColor(INK).text(text, PAGE_MARGIN, doc.y);
  doc.moveDown(0.4);
}

function rule(doc: Doc, width: number) {
  doc
    .strokeColor(RULE)
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + width, doc.y)
    .stroke();
}
