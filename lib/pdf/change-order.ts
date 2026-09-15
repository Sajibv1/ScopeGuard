/**
 * Change-order PDF generation (plan Feature 9, P1).
 *
 * Renders from `RenderedChangeOrder` — the same deterministic structure the
 * on-screen preview uses — so the exported totals are the on-screen totals by
 * construction. Nothing here recomputes a figure; it only lays out values
 * that lib/documents/render.ts already produced.
 *
 * Text is drawn as text, never rasterised, so the output is selectable and
 * searchable as the plan requires.
 *
 * Internal review notes are omitted unless the caller explicitly opted in,
 * which `renderChangeOrder` handles upstream by leaving `note` null.
 */

import "server-only";

import PDFDocument from "pdfkit";

import type { RenderedChangeOrder } from "../documents/render.ts";
import { SECTION_TITLES } from "../ai/schemas.ts";

const PAGE_MARGIN = 56;
const INK = "#191d24";
const MUTED = "#5b6678";
const RULE = "#d6dae2";

/** Standard PDF base-14 fonts: no font files to ship, no licensing to check. */
const BODY = "Helvetica";
const BOLD = "Helvetica-Bold";
const ITALIC = "Helvetica-Oblique";

export interface PdfOptions {
  rendered: RenderedChangeOrder;
  /** Narrative prose, keyed by section. Only these keys are ever rendered. */
  sections: Record<string, string>;
  /** Off by default — exports must not leak internal review notes. */
  includeInternalNotes?: boolean;
}

/**
 * Build the change order and resolve to a complete PDF buffer.
 *
 * pdfkit is a stream API; we collect it rather than piping to the response so
 * that a mid-render failure produces a clean error instead of a truncated
 * download the user might mistake for a real document.
 */
export function renderChangeOrderPdf(options: PdfOptions): Promise<Buffer> {
  const { rendered, sections } = options;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE_MARGIN,
      // Required for the footer pass: switchToPage() can only revisit pages
      // that are still buffered.
      bufferPages: true,
      info: {
        Title: `Change order ${rendered.reference} — ${rendered.projectName}`,
        Author: rendered.clientName ? `Prepared for ${rendered.clientName}` : "ScopeGuard",
        Subject: "Change order",
        Creator: "ScopeGuard",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      draw(doc, options);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

type Doc = InstanceType<typeof PDFDocument>;

function draw(doc: Doc, { rendered, sections, includeInternalNotes }: PdfOptions) {
  const width = doc.page.width - PAGE_MARGIN * 2;

  // ── Header ────────────────────────────────────────────────────────────────
  doc.font(BOLD).fontSize(18).fillColor(INK).text("Change order");
  doc
    .font(BODY)
    .fontSize(10)
    .fillColor(MUTED)
    .text(`${rendered.reference} · ${rendered.projectName}`);

  doc.moveDown(0.8);
  rule(doc, width);
  doc.moveDown(0.8);

  // ── Facts ─────────────────────────────────────────────────────────────────
  // Every value here comes from stored records, never from generated prose.
  const facts: Array<[string, string]> = [
    ["Prepared", rendered.preparedOn],
    ["Client", rendered.clientName ?? "—"],
    ["Baseline", rendered.baselineLabel],
    ["Status", rendered.decisionStatus],
  ];

  const labelWidth = 90;
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

  // ── Narrative sections ────────────────────────────────────────────────────
  section(doc, width, SECTION_TITLES.change_order_summary, sections.change_order_summary);

  // ── Requested changes ─────────────────────────────────────────────────────
  if (rendered.requestedChanges.length > 0) {
    heading(doc, "Requested changes");

    for (const change of rendered.requestedChanges) {
      if (doc.y > doc.page.height - 140) doc.addPage();

      doc.font(BOLD).fontSize(10).fillColor(INK).text(change.title, { width });

      doc
        .font(BODY)
        .fontSize(9)
        .fillColor(MUTED)
        .text(change.labelText, { width, continued: false });

      if (change.description) {
        doc.font(BODY).fontSize(9.5).fillColor(INK).text(change.description, { width });
      }

      /*
       * A decision resting on something outside the agreement is labelled as
       * such. The client reading this must be able to tell a contract term
       * from a recollection of a phone call.
       */
      if (change.contextBased) {
        doc
          .font(ITALIC)
          .fontSize(8.5)
          .fillColor(MUTED)
          .text("Based on context provided by the developer, not on the written agreement.", {
            width,
          });
      }

      if (includeInternalNotes && change.note) {
        doc
          .font(ITALIC)
          .fontSize(8.5)
          .fillColor(MUTED)
          .text(`Internal note: ${change.note}`, { width });
      }

      doc.moveDown(0.5);
    }

    doc.moveDown(0.3);
  }

  // ── Estimate table ────────────────────────────────────────────────────────
  if (rendered.lines.length > 0) {
    if (doc.y > doc.page.height - 200) doc.addPage();

    heading(doc, "Additional work");

    const columns = {
      description: PAGE_MARGIN,
      hours: PAGE_MARGIN + width - 210,
      rate: PAGE_MARGIN + width - 140,
      total: PAGE_MARGIN + width - 70,
    };

    const headerY = doc.y;
    doc.font(BOLD).fontSize(8.5).fillColor(MUTED);
    doc.text("WORK", columns.description, headerY, { width: width - 220 });
    doc.text("HOURS", columns.hours, headerY, { width: 60, align: "right" });
    doc.text("RATE", columns.rate, headerY, { width: 60, align: "right" });
    doc.text("TOTAL", columns.total, headerY, { width: 70, align: "right" });

    doc.moveDown(0.4);
    rule(doc, width);
    doc.moveDown(0.4);

    for (const line of rendered.lines) {
      if (doc.y > doc.page.height - 110) {
        doc.addPage();
        doc.moveDown(0.5);
      }

      const rowY = doc.y;
      doc.font(BODY).fontSize(9.5).fillColor(INK);
      doc.text(line.description, columns.description, rowY, { width: width - 230 });

      const rowEnd = doc.y;

      doc.text(line.hours || "—", columns.hours, rowY, { width: 60, align: "right" });
      doc.text(line.rate, columns.rate, rowY, { width: 60, align: "right" });
      doc.text(line.total, columns.total, rowY, { width: 70, align: "right" });

      doc.y = Math.max(rowEnd, rowY + 12);
      doc.moveDown(0.35);
    }

    rule(doc, width);
    doc.moveDown(0.4);

    const totalY = doc.y;
    doc.font(BODY).fontSize(10).fillColor(INK);
    doc.text("Subtotal", columns.description, totalY, { width: 200 });
    doc.text(rendered.subtotal, columns.total, totalY, { width: 70, align: "right" });

    // The tax row states its label and rate — the reader can see the figure
    // derives from a rate the developer entered, not from the tool.
    if (rendered.taxAmount !== null) {
      doc.moveDown(0.3);
      const taxY = doc.y;
      doc.font(BODY).fontSize(10).fillColor(INK);
      doc.text(`${rendered.taxLabel ?? "Tax"} (${rendered.taxRate ?? "—"})`, columns.description, taxY, {
        width: 220,
      });
      doc.text(rendered.taxAmount, columns.total, taxY, { width: 70, align: "right" });
    }

    doc.moveDown(0.3);
    const grandY = doc.y;
    doc.font(BOLD).fontSize(10.5).fillColor(INK);
    doc.text(`Total (${rendered.currency})`, columns.description, grandY, { width: 200 });
    doc.text(rendered.total, columns.total, grandY, { width: 70, align: "right" });

    doc.moveDown(1);

    /*
     * An incomplete estimate is stated rather than hidden. A total that
     * silently omits unpriced lines would be a number the client could rely
     * on and the developer could not.
     */
    if (rendered.estimateIncomplete) {
      doc
        .font(ITALIC)
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(
          "Some lines have no hours entered yet, so this total is not final.",
          PAGE_MARGIN,
          doc.y,
          { width },
        );
      doc.moveDown(0.6);
    }
  }

  // ── Assumptions, exclusions, open questions ───────────────────────────────
  section(doc, width, SECTION_TITLES.change_order_assumptions, sections.change_order_assumptions);
  section(doc, width, SECTION_TITLES.change_order_exclusions, sections.change_order_exclusions);

  if (rendered.openQuestions.length > 0) {
    heading(doc, "Open questions");
    for (const question of rendered.openQuestions) {
      doc.font(BODY).fontSize(9.5).fillColor(INK).text(`•  ${question}`, { width, indent: 4 });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.5);
  }

  // ── Footer on every page ──────────────────────────────────────────────────
  /*
   * The footer sits inside the bottom margin, and pdfkit treats any text that
   * starts past the bottom margin as an overflow that needs a fresh page — so
   * writing footers naively APPENDS a page per footer, which then needs its
   * own footer. A three-page order came out as nine.
   *
   * Zeroing the bottom margin for the duration of each footer write tells
   * pdfkit there is nothing to overflow into. The range is captured once, up
   * front, so the loop bound cannot drift even if a write did add a page.
   */
  const range = doc.bufferedPageRange();
  const pageCount = range.count;

  for (let i = range.start; i < range.start + pageCount; i++) {
    doc.switchToPage(i);

    // margins live on the page, so this must be reset after every switch.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const footerY = doc.page.height - PAGE_MARGIN + 12;
    doc
      .font(BODY)
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `${rendered.reference} · ${rendered.projectName} · page ${i - range.start + 1} of ${pageCount}`,
        PAGE_MARGIN,
        footerY,
        { width, align: "left", lineBreak: false },
      );

    // The product does not determine legal enforceability, and the document
    // it produces should not imply otherwise.
    doc.text("Estimate and scope assessment. Not a legal determination.", PAGE_MARGIN, footerY, {
      width,
      align: "right",
      lineBreak: false,
    });

    doc.page.margins.bottom = bottomMargin;
  }
}

function heading(doc: Doc, text: string) {
  doc.moveDown(0.3);
  doc.font(BOLD).fontSize(11).fillColor(INK).text(text, PAGE_MARGIN, doc.y);
  doc.moveDown(0.4);
}

function section(doc: Doc, width: number, title: string, body: string | undefined) {
  const text = body?.trim();
  if (!text) return;

  if (doc.y > doc.page.height - 160) doc.addPage();

  heading(doc, title);
  doc.font(BODY).fontSize(9.5).fillColor(INK).text(text, PAGE_MARGIN, doc.y, {
    width,
    align: "left",
  });
  doc.moveDown(0.6);
}

function rule(doc: Doc, width: number) {
  doc
    .strokeColor(RULE)
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + width, doc.y)
    .stroke();
}
