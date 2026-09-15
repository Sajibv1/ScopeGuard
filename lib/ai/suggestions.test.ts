import assert from "node:assert/strict";
import { test } from "node:test";

import { findLegalClaims, findMonetaryClaims } from "./prompts.ts";
import { fixtureHourSuggestions } from "./fixtures.ts";

test("findLegalClaims catches conclusion language wherever it hides", () => {
  assert.deepEqual(findLegalClaims("This may breach the agreement"), ["breach"]);
  assert.deepEqual(findLegalClaims("the clause is unenforceable"), ["unenforceable"]);
  assert.deepEqual(findLegalClaims("you could be liable for damages"), ["liable"]);
  assert.deepEqual(findLegalClaims("null and void"), ["null and void"]);
  assert.ok(findLegalClaims("this violates the IP grant").length > 0);
});

test("findLegalClaims passes neutral topic descriptions", () => {
  // The flagger's ceiling: name the topic, say who should look at it.
  assert.deepEqual(
    findLegalClaims(
      "The request involves ownership of delivered work. A professional can confirm which terms apply.",
    ),
    [],
  );
  assert.deepEqual(findLegalClaims("Worth having a professional review the warranty wording."), []);
  assert.deepEqual(findLegalClaims(""), []);
});

test("monetary claims still catch hours and prices", () => {
  const claims = findMonetaryClaims("This takes about 6 hours and costs $500.");
  assert.ok(claims.some((claim) => claim.includes("duration")), claims.join("; "));
  assert.ok(claims.some((claim) => claim.includes("currency")), claims.join("; "));
});

test("hour fixtures are rough, honest references", () => {
  const result = fixtureHourSuggestions([
    { description: "Implement the OAuth callback and account-linking flow" },
    { description: "Swap the hero image" },
    { description: "Update the footer text" },
  ]);

  const [oauth, image, footer] = result.suggestions;
  assert.ok(oauth && image && footer, "one draft per line");

  assert.equal(oauth.estimate_line, "Implement the OAuth callback and account-linking flow");
  assert.ok(oauth.draft_hours >= 4 && oauth.draft_hours <= 8, "auth work anchors mid-single digits");
  assert.ok(oauth.rationale.length > 10, "rationale names the driver");

  assert.ok(image.draft_hours < oauth.draft_hours, "an asset swap is smaller than auth work");
  assert.ok(footer.draft_hours > 0 && footer.draft_hours <= 4, "default is small");
  // Round figures only — precision the fixture does not have would be the
  // exact failure mode this feature exists to avoid.
  for (const suggestion of result.suggestions) {
    assert.equal(suggestion.draft_hours * 2, Math.round(suggestion.draft_hours * 2));
  }
});
