import assert from "node:assert/strict";
import { test } from "node:test";

import { extractText, getDocumentProxy } from "unpdf";

import { renderInvoicePdf, invoiceNumber } from "./invoice.ts";
import type { RenderedChangeOrder } from "../documents/render.ts";

/**
 * The invoice shares its fixture shape with the change-order tests on
 * purpose: both documents render the same RenderedChangeOrder, so these
 * figures must match those, not a second set invented here.
 */
const RENDERED: RenderedChangeOrder = {
  reference: "CR-001",
  projectName: "Northwind Bakery Website",
  clientName: "Northwind Bakery",
  preparedOn: "11 September 2026",
  baselineLabel: "Baseline version 1, confirmed 10 September 2026",
  currency: "USD",
  requestedChanges: [],
  lines: [
    {
      description: "Configure the identity provider",
      hours: "3",
      rate: "$85.00",
      total: "$255.00",
      linkedItem: null,
    },
    {
      description: "Implement the callback and account-linking flow",
      hours: "5",
      rate: "$85.00",
      total: "$425.00",
      linkedItem: null,
    },
  ],
  subtotal: "$680.00",
  taxLabel: "Sales tax",
  taxRate: "8.25%",
  taxAmount: "$56.10",
  total: "$736.10",
  hasEstimate: true,
  estimateIncomplete: false,
  openQuestions: [],
  sections: {},
  decisionStatus: "Approval recorded by user 11 September 2026",
};

async function textOf(pdf: Buffer): Promise<string> {
  const proxy = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(proxy, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

test("produces a valid, selectable-text PDF", async () => {
  const pdf = await renderInvoicePdf(RENDERED);

  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.byteLength > 800, "PDF is suspiciously small");

  const text = await textOf(pdf);
  assert.match(text, /Invoice/);
  assert.match(text, /Northwind Bakery/);
});

test("the invoice number derives from the change-order reference", () => {
  assert.equal(invoiceNumber(RENDERED), "INV-CR-001");
});

test("amounts are exactly the change-order amounts", async () => {
  const pdf = await renderInvoicePdf(RENDERED);
  const text = await textOf(pdf);

  // The same figures the change order exported — never a second computation.
  assert.ok(text.includes("$255.00"), "line total missing");
  assert.ok(text.includes("$680.00"), "subtotal missing");
  assert.ok(text.includes("$56.10"), "tax missing");
  assert.ok(text.includes("$736.10"), "amount due missing");
  assert.match(text, /Amount due \(USD\)/);
});

test("cites the recorded approval without claiming a signature", async () => {
  const pdf = await renderInvoicePdf(RENDERED);
  const text = await textOf(pdf);

  assert.match(text, /Approval recorded by user/);
  assert.ok(!/signature/i.test(text), "must not imply a verified signature");
});

test("omits the tax row when no rate was entered", async () => {
  const pdf = await renderInvoicePdf({
    ...RENDERED,
    taxLabel: null,
    taxRate: null,
    taxAmount: null,
    total: RENDERED.subtotal,
  });
  const text = await textOf(pdf);

  assert.ok(!text.includes("Sales tax"));
  assert.match(text, /Amount due/);
});

test("carries the not-a-legal-determination footer on every page", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    description: `Work component number ${i + 1} with a reasonably long description`,
    hours: "2",
    rate: "$85.00",
    total: "$170.00",
    linkedItem: null,
  }));

  const pdf = await renderInvoicePdf({ ...RENDERED, lines: many });

  const proxy = await getDocumentProxy(new Uint8Array(pdf));
  assert.ok(proxy.numPages > 1, "expected multiple pages");

  const text = await textOf(pdf);
  assert.match(text, /Not a legal determination/);
  assert.match(text, new RegExp(`page ${proxy.numPages} of ${proxy.numPages}`, "i"));
});
