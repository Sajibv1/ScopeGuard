import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotesScopeExtractionSchema } from "./schemas.ts";
import { fixtureNotesExtraction } from "./fixtures.ts";

/**
 * The no-source path (plan §10, Tier 2): the user's rough notes become
 * proposed scope items. The property that makes this honest is a structural
 * one — the output shape has NO quote fields, so nothing proposed from
 * memory can ever be presented, stored, or displayed as a quoted commitment.
 */
const NOTES = `Call with Priya, Tuesday.

We'll build the five-page marketing site, English only.

Two rounds of revisions are included.

Client sends logo and copy by Friday.

Maybe we'll add a blog page later, not for now.

User accounts are excluded, she was clear about that.`;

describe("notes extraction (no-source mode)", () => {
  it("proposes items from the notes", () => {
    const extraction = fixtureNotesExtraction(NOTES);

    assert.ok(extraction.items.length >= 3, `expected several items, got ${extraction.items.length}`);

    for (const item of extraction.items) {
      assert.equal(typeof item.category, "string");
      assert.ok(item.description.length > 0);
      // The shape itself carries the boundary: no quote, no locator.
      assert.ok(!("quote" in item));
      assert.ok(!("locator" in item));
    }
  });

  it("keeps the notes' hedging instead of resolving it", () => {
    const extraction = fixtureNotesExtraction(NOTES);

    const blog = extraction.items.find((item) => /blog/i.test(item.description));
    assert.ok(blog, "the blog item was not proposed");
    // "Maybe ... later" must survive into the description — the fixture
    // quotes the sentence as the description, same as the live prompt's
    // rule to keep the notes' uncertainty rather than resolve it.
    assert.match(blog.description, /maybe/i);
  });
});

describe("the notes schema cannot carry a quote", () => {
  it("strips quote and locator fields a model tries to add", () => {
    const parsed = NotesScopeExtractionSchema.parse({
      items: [
        {
          category: "deliverable",
          description: "Five-page marketing site",
          quote: "We'll build the five-page site",
          locator: "Paragraph 1",
        },
      ],
    });

    // zod strips unknown keys: the quote attempt is silently discarded and
    // the item that reaches the database is quoteless memory.
    assert.deepEqual(parsed.items[0], {
      category: "deliverable",
      description: "Five-page marketing site",
    });
  });

  it("rejects an item with no description", () => {
    assert.throws(() =>
      NotesScopeExtractionSchema.parse({ items: [{ category: "deliverable" }] }),
    );
  });
});
