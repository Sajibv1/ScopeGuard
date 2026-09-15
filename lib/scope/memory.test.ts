import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isConfirmedByAny, partitionMemoryItems } from "./memory.ts";
import type { ScopeItem } from "../types.ts";

/**
 * Memory matching (plan §10, Tier 2): when a real document — the client's
 * confirming reply — is ingested over a notes baseline, a remembered item is
 * confirmed only when the document plainly restates it. The matcher is
 * deterministic word overlap on purpose: the decision changes what is
 * presented as confirmed, so it must be explainable and identical on every
 * run, and a borderline match must resolve to "not confirmed".
 */

function memoryItem(description: string): ScopeItem {
  return {
    id: description.slice(0, 12),
    scopeVersionId: "notes-v1",
    category: "deliverable",
    description,
    sourceQuote: null,
    sourceLocator: null,
    quoteStart: null,
    quoteEnd: null,
    userAdded: true,
    commitment: null,
    provenance: "memory",
    confirmed: false,
    sortOrder: 0,
  };
}

describe("isConfirmedByAny", () => {
  it("confirms a memory item the reply restates", () => {
    // The client words the confirmation differently from the notes; the
    // quote is matched as well as the extracted description.
    assert.equal(
      isConfirmedByAny("Five-page marketing site in English only", [
        {
          description: "The site will have up to five pages and be delivered in English",
          quote: "up to five pages and will be delivered in English only",
        },
      ]),
      true,
    );
  });

  it("does not confirm a memory item the reply never mentions", () => {
    assert.equal(
      isConfirmedByAny("Blog section later", [
        {
          description: "The site will have up to five pages",
          quote: "up to five pages and will be delivered in English only",
        },
      ]),
      false,
    );
  });

  it("does not confirm on filler-word overlap alone", () => {
    // "call" and "agreed" are dropped as stop words; two content words must
    // overlap, so a generic sentence is never mistaken for a confirmation.
    assert.equal(
      isConfirmedByAny("We agreed on the call about the website", [
        {
          description: "Something else entirely, like hosting and domain setup",
          quote: "the client will supply hosting credentials",
        },
      ]),
      false,
    );
  });

  it("does not confirm against an empty candidate list", () => {
    assert.equal(isConfirmedByAny("Five-page site", []), false);
  });
});

describe("partitionMemoryItems", () => {
  it("splits confirmed from unconfirmed, and the split is the flag", () => {
    const memory = [
      memoryItem("Five-page marketing site in English only"),
      memoryItem("Blog section later"),
      memoryItem("Client sends logo and copy"),
    ];

    const extracted = [
      {
        description: "Up to five pages, delivered in English",
        quote: "up to five pages and will be delivered in English only",
      },
      {
        description: "Client provides logo and copy",
        quote: "The client will provide the logo and all copy",
      },
    ];

    const { confirmed, unconfirmed } = partitionMemoryItems(memory, extracted);

    // Confirmed items are superseded by the extracted ones (which carry
    // verified quotes); unconfirmed ones carry forward, flagged.
    assert.deepEqual(
      confirmed.map((item) => item.description),
      ["Five-page marketing site in English only", "Client sends logo and copy"],
    );
    assert.deepEqual(
      unconfirmed.map((item) => item.description),
      ["Blog section later"],
    );
  });
});
