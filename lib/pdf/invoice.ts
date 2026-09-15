/**
 * Invoice PDF generation (§8 "invoice creation", honest version).
 *
 * An invoice here is a rendering of an ALREADY-APPROVED change request: the
 * lines, hours, rates, tax and totals are the same deterministic values the
 * change order exported, computed by the same computeTotals. There is no
 * payment processing, no sending, and no new number anywhere — if the two
 * documents ever disagree, that is a bug in this file, not a business fact.
 *
 * The approval it cites is "recorded by user", never a verified signature
 * (plan §10).
 */

import "server-only";

import PDFDocument from "pdfkit";

import type { RenderedChangeOrder } from "../documents/render.ts";

const PAGE_MARGIN = 56;
const INK = "#191d24";
const MUTED = "#5b6678";
const RULE = "#d6dae2";

const BODY = "Helvetica";
const BOLD = "Helvetica-Bold";
const ITALIC = "Helvetica-Oblique";

export function renderInvoicePdf(rendered: RenderedChangeOrder): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE_MARGIN,
      bufferPages: true, // required for the footer pass
      info: {
        Title: `Invoice ${invoiceNumber(rendered)} — ${rendered.projectName}`,
        Author: rendered.clientName ? `Billed to ${rendered.clientName}` : "ScopeGuard",
        Subject: "Invoice for approved additional work",
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

/** Invoice number derives from the change-order reference — never a counter the invoice could drift from. */
export function invoiceNumber(rendered: RenderedChangeOrder): string {
  return `INV-${rendered.reference}`;
}

type Doc = InstanceType<typeof PDFDocument>;

function draw(doc: Doc, rendered: RenderedChangeOrder) {
  const width = doc.page.width - PAGE_MARGIN * 2;

  // ── Header ────────────────────────────────────────────────────────────────
  doc.font(BOLD).fontSize(18).fillColor(INK).text("Invoice");
  doc.font(BODY).fontSize(10).fillColor(MUTED).text(
    `${invoiceNumber(rendered)} · ${rendered.projectName}`,
  );

  doc.moveDown(0.8);
  rule(doc, width);
  doc.moveDown(0.8);

  // ── Facts ─────────────────────────────────────────────────────────────────
  const facts: Array<[string, string]> = [
    ["Invoice date", rendered.preparedOn],
    ["Billed to", rendered.clientName ?? "—"],
    ["Change order", rendered.reference],
    ["Approval", rendered.decisionStatus],
    ["Baseline", rendered.baselineLabel],
  ];

  const labelWidth = 110;
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

  // ── Line items ────────────────────────────────────────────────────────────
  heading(doc, "Approved additional work");

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

  // ── Totals ────────────────────────────────────────────────────────────────
  // Identical values to the change order: both documents render from the same
  // RenderedChangeOrder, so they cannot disagree.
  const subtotalY = doc.y;
  doc.font(BODY).fontSize(10).fillColor(INK);
  doc.text("Subtotal", columns.description, subtotalY, { width: 200 });
  doc.text(rendered.subtotal, columns.total, subtotalY, { width: 70, align: "right" });

  if (rendered.taxAmount !== null) {
    doc.moveDown(0.3);
    const taxY = doc.y;
    doc.font(BODY).fontSize(10).fillColor(INK);
    doc.text(
      `${rendered.taxLabel ?? "Tax"} (${rendered.taxRate ?? "—"})`,
      columns.description,
      taxY,
      { width: 220 },
    );
    doc.text(rendered.taxAmount, columns.total, taxY, { width: 70, align: "right" });
  }

  doc.moveDown(0.3);
  const amountY = doc.y;
  doc.font(BOLD).fontSize(11).fillColor(INK);
  doc.text(`Amount due (${rendered.currency})`, columns.description, amountY, { width: 220 });
  doc.text(rendered.total, columns.total, amountY, { width: 70, align: "right" });

  doc.moveDown(1);

  if (rendered.estimateIncomplete) {
    doc
      .font(ITALIC)
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(
        "Some lines have no hours entered yet, so this amount is not final.",
        PAGE_MARGIN,
        doc.y,
        { width },
      );
    doc.moveDown(0.6);
  }

  // ── Footer on every page ──────────────────────────────────────────────────
  // Same footer mechanics as the change order: zeroing the bottom margin for
  // each write, or pdfkit appends a page per footer (see change-order.ts).
  const range = doc.bufferedPageRange();
  const pageCount = range.count;

  for (let i = range.start; i < range.start + pageCount; i++) {
    doc.switchToPage(i);

    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const footerY = doc.page.height - PAGE_MARGIN + 12;
    doc
      .font(BODY)
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `${invoiceNumber(rendered)} · ${rendered.projectName} · page ${i - range.start + 1} of ${pageCount}`,
        PAGE_MARGIN,
        footerY,
        { width, align: "left", lineBreak: false },
      );

    doc.text("Amount due reflects the approved change order. Not a legal determination.", PAGE_MARGIN, footerY, {
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

function rule(doc: Doc, width: number) {
  doc
    .strokeColor(RULE)
    .lineWidth(0.5)
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(PAGE_MARGIN + width, doc.y)
    .stroke();
}
