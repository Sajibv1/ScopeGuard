import assert from "node:assert/strict";
import { test } from "node:test";

import { generate, type ModelCache } from "./provider.ts";
import { EXTRACT_SCOPE_SYSTEM, extractScopeUser, PROMPT_VERSIONS } from "./prompts.ts";
import { fixtureScopeExtraction } from "./fixtures.ts";
import { ScopeExtractionSchema } from "./schemas.ts";
import { buildParagraphLocators, verifyQuote } from "./citations.ts";
import { SAMPLE_SCOPE_TEXT } from "../sample/sample-project.ts";

/**
 * The sample seed's model cache (see lib/ai/model-cache.ts and the cache
 * block in provider.generate()).
 *
 * Two properties make the cache honest:
 *  1. A cached payload is served ONLY after re-running the schema parse and
 *     the caller's validate() — the same citation verification that gates
 *     live model output.
 *  2. A payload that fails either check is treated as a miss and the call
 *     proceeds to the live path, so a poisoned or stale row can never
 *     inject unverified claims.
 *
 * These tests run generate() with a key configured (so it takes the live
 * path) but a cache that answers before any network call is needed. The
 * miss test points the client at a dead local port, making the failure
 * immediate and offline.
 */

const locators = buildParagraphLocators(SAMPLE_SCOPE_TEXT);

function callOptions(cache: ModelCache) {
  return {
    operation: "extract",
    system: EXTRACT_SCOPE_SYSTEM,
    user: extractScopeUser(SAMPLE_SCOPE_TEXT, ""),
    schema: ScopeExtractionSchema,
    schemaName: "scope_extraction",
    cache,
    // The same citation check the real extraction path passes to generate().
    validate: (data: { items: Array<{ quote: string }> }) => {
      const bad = data.items.filter(
        (item) =>
          !verifyQuote(item.quote, null, { sourceText: SAMPLE_SCOPE_TEXT, locators }).ok,
      );
      return bad.length === 0 ? null : `${bad.length} quotes do not appear in the document.`;
    },
    fixture: () => fixtureScopeExtraction(SAMPLE_SCOPE_TEXT, () => "Paragraph 1"),
  } as const;
}

test("a cached payload that passes verification is served without a model call", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const keys: string[] = [];
    // The fixture's quotes are verbatim by construction, so as a cached
    // payload it passes the same validate() that gates live output.
    const payload = fixtureScopeExtraction(SAMPLE_SCOPE_TEXT, () => "Paragraph 1");
    const cache: ModelCache = {
      get: async (key) => {
        keys.push(key);
        return payload;
      },
      put: async () => {},
    };

    const result = await generate(callOptions(cache));

    assert.equal(keys.length, 1, "cache was not consulted exactly once");
    assert.equal(result.fixture, false);
    assert.equal(result.usage.cached, true);
    assert.equal(result.usage.attempts, 0);
    assert.deepEqual(result.data, payload);
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test("a cached payload that fails citation verification is rejected", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  // Connection-refused port: the fallback live call fails immediately and
  // offline once the poisoned cache row has been discarded.
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:9";
  try {
    const poisoned = fixtureScopeExtraction(SAMPLE_SCOPE_TEXT, () => "Paragraph 1");
    poisoned.items[0]!.quote = "This sentence is not in the sample document.";
    const cache: ModelCache = {
      get: async () => poisoned,
      put: async () => {},
    };

    // The poisoned row must NOT come back as a result. The call proceeds to
    // the live path and rejects against the dead endpoint.
    await assert.rejects(generate(callOptions(cache)));
  } finally {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  }
});
