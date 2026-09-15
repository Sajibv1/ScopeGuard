import assert from "node:assert/strict";
import { test } from "node:test";

import { isGarbled } from "./extract.ts";

const REAL_SCOPE = `Statement of Work — Northwind Bakery Website

1. Overview

Meridian Web Studio ("the Developer") will design and build a marketing
website for Northwind Bakery ("the Client"). This document defines the
agreed scope of work.

2. Deliverables

The Developer will deliver a responsive marketing website consisting of up
to five pages: Home, About, Menu, Locations, and Contact. The website will
be delivered in English only.

3. Exclusions

User accounts, customer logins, and any form of authentication are
explicitly excluded from this engagement.`;

test("accepts ordinary extracted prose", () => {
  assert.equal(isGarbled(REAL_SCOPE), false);
});

test("accepts a sparse, heavily line-broken layout", () => {
  // PDF extraction often produces short lines and lots of newlines. That is
  // normal, not garbled.
  const sparse = Array.from({ length: 40 }, (_, i) => `Clause ${i + 1} of the agreement.`).join(
    "\n\n",
  );
  assert.equal(isGarbled(sparse), false);
});

test("accepts text with tables of figures", () => {
  const table = `Item          Hours   Rate    Total
Design            8   85.00   680.00
Development      12   85.00  1020.00
Testing           4   85.00   340.00`;
  assert.equal(isGarbled(table), false);
});

test("rejects replacement-character soup", () => {
  assert.equal(isGarbled("���������������������������������������������"), true);
});

test("rejects text with no word breaks", () => {
  const runOn = "abcdefghij".repeat(20);
  assert.equal(isGarbled(runOn), true);
});

test("rejects control-character noise", () => {
  const noise = "\u0001\u0002\u0003 text \u0004\u0005\u0006".repeat(30);
  assert.equal(isGarbled(noise), true);
});

test("does not judge a very short string", () => {
  // Too little signal to call it either way; the empty-document check covers
  // the genuinely useless case.
  assert.equal(isGarbled("Scope: one page."), false);
});
