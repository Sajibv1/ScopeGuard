import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeRequestFixture } from "./analyze-request.ts";
import { extractScopeFixture } from "./extract-scope.ts";
import { buildParagraphLocators, verifyQuote } from "./citations.ts";
import {
  SAMPLE_CLIENT_MESSAGE,
  SAMPLE_SCOPE_TEXT,
} from "../sample/sample-project.ts";
import type { ScopeItem } from "../types.ts";

/**
 * The sample seed's fallback path (see lib/sample/seed.ts).
 *
 * When the live model's output fails citation verification even after its
 * retry, the seed falls back to the deterministic engine so the demo always
 * completes. These tests pin the property that makes that fallback honest:
 * the fallback's citations verify against the REAL sample document by the
 * SAME verifier that rejected the model's, and the result is labeled
 * fixture so nothing downstream mistakes it for model output.
 */

const locators = buildParagraphLocators(SAMPLE_SCOPE_TEXT);

test("extractScopeFixture produces citations that verify against the sample document", () => {
  const result = extractScopeFixture(SAMPLE_SCOPE_TEXT, locators);

  assert.equal(result.fixture, true);
  assert.equal(result.model, "fixture");
  assert.ok(result.items.length > 0, "fixture extraction found no scope items");
  assert.equal(result.rejected.length, 0, "fixture produced a quote the verifier rejected");

  for (const item of result.items) {
    // The exact check that rejected the live model's quotes.
    const check = verifyQuote(item.sourceQuote, item.sourceLocator, {
      sourceText: SAMPLE_SCOPE_TEXT,
      locators,
    });
    assert.ok(check.ok, `fixture quote failed verification: "${item.sourceQuote.slice(0, 60)}"`);
    assert.equal(item.quoteStart, check.start);
    assert.equal(item.quoteEnd, check.end);
  }
});

test("analyzeRequestFixture produces assessments whose evidence verifies", () => {
  // The fixture analysis runs against the fixture-extracted baseline — the
  // same pairing the seed uses when both live calls fail.
  const extraction = extractScopeFixture(SAMPLE_SCOPE_TEXT, locators);
  const scopeItems: ScopeItem[] = extraction.items.map((item, index) => ({
    id: `fixture-${index}`,
    scopeVersionId: "v1",
    category: item.category,
    description: item.description,
    sourceQuote: item.sourceQuote,
    sourceLocator: item.sourceLocator,
    quoteStart: item.quoteStart,
    quoteEnd: item.quoteEnd,
    userAdded: false,
    commitment: null,
    provenance: "document" as const,
    confirmed: true,
    sortOrder: index,
  }));

  const result = analyzeRequestFixture({
    clientMessage: SAMPLE_CLIENT_MESSAGE,
    documentText: SAMPLE_SCOPE_TEXT,
    locators,
    scopeItems,
    userContext: null,
  });

  assert.equal(result.fixture, true);
  assert.equal(result.model, "fixture");
  assert.ok(result.items.length > 0, "fixture analysis found no request items");

  for (const item of result.items) {
    // The request excerpt must trace to text the client actually wrote.
    const excerpt = verifyQuote(item.sourceExcerpt, null, {
      sourceText: SAMPLE_CLIENT_MESSAGE,
      locators: [
        {
          id: "msg",
          kind: "paragraph",
          label: "Client message",
          start: 0,
          end: SAMPLE_CLIENT_MESSAGE.length,
        },
      ],
    });
    assert.ok(excerpt.ok, `fixture excerpt not in the client message: "${item.sourceExcerpt.slice(0, 60)}"`);

    // And every citation must verify against the document.
    for (const claim of [...item.supportingEvidence, ...item.conflictingEvidence]) {
      const check = verifyQuote(claim.quote, null, {
        sourceText: SAMPLE_SCOPE_TEXT,
        locators,
      });
      assert.ok(check.ok, `fixture citation failed verification: "${claim.quote.slice(0, 60)}"`);
    }

    // The §6 guarantee holds on the fallback path too: no strong label
    // without verified supporting evidence.
    if (item.proposedLabel === "included" || item.proposedLabel === "potentially_additional") {
      assert.ok(
        item.supportingEvidence.length > 0,
        `"${item.title}" kept a strong label with no verified evidence`,
      );
    }
  }
});
