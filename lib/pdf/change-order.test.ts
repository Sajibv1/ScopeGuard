import assert from "node:assert/strict";
import { test } from "node:test";

import { extractText, getDocumentProxy } from "unpdf";

import { renderChangeOrderPdf } from "./change-order.ts";
import type { RenderedChangeOrder } from "../documents/render.ts";

const RENDERED: RenderedChangeOrder = {
  reference: "CR-001",
  projectName: "Northwind Bakery Website",
  clientName: "Northwind Bakery",
  preparedOn: "11 September 2026",
  baselineLabel: "Baseline version 1, confirmed 10 September 2026",
  currency: "USD",
  requestedChanges: [
    {
      title: "Add customer accounts",
      description: "Customers can register and save favourites.",
      label: "potentially_additional",
      labelText: "Potentially additional",
      userDecided: false,
      contextBased: false,
      note: "INTERNAL: client was difficult about this last time",
    },
    {
      title: "Replace the hero image",
      description: "Swap in the new photograph.",
      label: "needs_clarification",
      labelText: "Needs clarification",
      userDecided: true,
      contextBased: true,
      note: null,
    },
  ],
  lines: [
    {
      description: "Configure the identity provider",
      hours: "3",
      rate: "$85.00",
      total: "$255.00",
      linkedItem: "Add customer accounts",
    },
    {
      description: "Implement the callback and account-linking flow",
      hours: "5",
      rate: "$85.00",
      total: "$425.00",
      linkedItem: "Add customer accounts",
    },
  ],
  subtotal: "$680.00",
  taxLabel: "Sales tax",
  taxRate: "8.25%",
  taxAmount: "$56.10",
  total: "$736.10",
  hasEstimate: true,
  estimateIncomplete: false,
  openQuestions: ["How many revision rounds have already been completed?"],
  sections: {},
  decisionStatus: "Draft — not yet sent",
};

const SECTIONS = {
  change_order_summary:
    "This change order covers customer accounts and a homepage image replacement.",
  change_order_assumptions: "The client supplies all imagery in final form.",
  change_order_exclusions: "Items under clarification are not included.",
};

async function textOf(pdf: Buffer): Promise<string> {
  const proxy = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(proxy, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

test("produces a valid PDF file", async () => {
  const pdf = await renderChangeOrderPdf({ rendered: RENDERED, sections: SECTIONS });

  assert.ok(pdf.byteLength > 800, "PDF is suspiciously small");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

test("text is selectable, not rasterised", async () => {
  const pdf = await renderChangeOrderPdf({ rendered: RENDERED, sections: SECTIONS });
  const text = await textOf(pdf);

  // If the content were drawn as an image, none of this would come back.
  assert.match(text, /Change order/);
  assert.match(text, /CR-001/);
  assert.match(text, /Northwind Bakery/);
});

test("exported figures are exactly the rendered figures", async () => {
  const pdf = await renderChangeOrderPdf({ rendered: RENDERED, sections: SECTIONS });
  const text = await textOf(pdf);

  // The guarantee the whole money layer exists to provide.
  assert.ok(text.includes("$255.00"), "line total missing");
  assert.ok(text.includes("$425.00"), "line total missing");
  assert.ok(text.includes("$680.00"), "subtotal missing");
  assert.ok(text.includes("USD"), "currency missing");
});

test("renders the tax row with its rate and the grand total", async () => {
  const pdf = await renderChangeOrderPdf({ rendered: RENDERED, sections: SECTIONS });
  const text = await textOf(pdf);

  assert.ok(text.includes("Sales tax"), "tax label missing");
  assert.ok(text.includes("8.25%"), "tax rate missing");
  assert.ok(text.includes("$56.10"), "tax amount missing");
  assert.ok(text.includes("$736.10"), "grand total missing");
});

test("renders no tax row when no rate was entered", async () => {
  const pdf = await renderChangeOrderPdf({
    rendered: {
      ...RENDERED,
      taxLabel: null,
      taxRate: null,
      taxAmount: null,
      total: RENDERED.subtotal,
    },
    sections: SECTIONS,
  });
  const text = await textOf(pdf);

  assert.ok(!text.includes("Sales tax"), "tax row rendered without a rate");
  assert.ok(!text.includes("8.25%"), "tax rate rendered without a rate");
  assert.ok(text.includes("$680.00"), "subtotal should stand in as the total");
});

test("omits internal notes by default", async () => {
  const pdf = await renderChangeOrderPdf({ rendered: RENDERED, sections: SECTIONS });
  const text = await textOf(pdf);

  assert.ok(
    !text.includes("client was difficult"),
    "internal review note leaked into the default export",
  );
});

test("includes internal notes only when explicitly requested", async () => {
  const pdf = await renderChangeOrderPdf({
    rendered: RENDERED,
    sections: SECTIONS,
    includeInternalNotes: true,
  });
  const text = await textOf(pdf);

  assert.ok(text.includes("client was difficult"));
});

test("labels a decision based on context outside the agreement", async () => {
  const pdf = await renderChangeOrderPdf({ rendered: RENDERED, sections: SECTIONS });
  const text = await textOf(pdf);

  assert.match(text, /context provided by the developer/i);
});

test("states when an estimate is incomplete rather than showing a bare total", async () => {
  const pdf = await renderChangeOrderPdf({
    rendered: { ...RENDERED, estimateIncomplete: true },
    sections: SECTIONS,
  });
  const text = await textOf(pdf);

  assert.match(text, /not final/i);
});

test("carries the not-a-legal-determination footer", async () => {
  const pdf = await renderChangeOrderPdf({ rendered: RENDERED, sections: SECTIONS });
  const text = await textOf(pdf);

  assert.match(text, /Not a legal determination/i);
});

test("renders open questions rather than dropping them", async () => {
  const pdf = await renderChangeOrderPdf({ rendered: RENDERED, sections: SECTIONS });
  const text = await textOf(pdf);

  assert.match(text, /revision rounds have already been completed/i);
});

test("survives an empty change order without an estimate", async () => {
  const pdf = await renderChangeOrderPdf({
    rendered: {
      ...RENDERED,
      requestedChanges: [],
      lines: [],
      hasEstimate: false,
      openQuestions: [],
    },
    sections: {},
  });

  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const text = await textOf(pdf);
  assert.match(text, /CR-001/);
});

test("paginates a long change order and numbers every page", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    description: `Work component number ${i + 1} with a reasonably long description line`,
    hours: "2",
    rate: "$85.00",
    total: "$170.00",
    linkedItem: null,
  }));

  const pdf = await renderChangeOrderPdf({
    rendered: { ...RENDERED, lines: many },
    sections: SECTIONS,
  });

  const proxy = await getDocumentProxy(new Uint8Array(pdf));
  assert.ok(proxy.numPages > 1, "expected multiple pages");

  const text = await textOf(pdf);
  assert.match(text, new RegExp(`page 1 of ${proxy.numPages}`, "i"));
  assert.match(text, new RegExp(`page ${proxy.numPages} of ${proxy.numPages}`, "i"));
});
