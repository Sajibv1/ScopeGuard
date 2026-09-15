/**
 * Sample project seeding (plan Feature 1).
 *
 * The demo runs the REAL workflow: it creates real rows, runs the real
 * analysis path, and produces real verified citations. Nothing here is a
 * screenshot or a shortcut around the product.
 *
 * Isolation comes from Supabase anonymous auth — each visitor is a distinct
 * user id, so RLS keeps one visitor's demo edits away from another's without
 * any special-casing. Resetting deletes the visitor's own sample project and
 * seeds a fresh one, giving the predictable starting state the plan asks for.
 */

import "server-only";

import { analyzeRequest, analyzeRequestFixture } from "@/lib/ai/analyze-request";
import { buildParagraphLocators } from "@/lib/ai/citations";
import { extractScope, extractScopeFixture } from "@/lib/ai/extract-scope";
import { createModelCache } from "@/lib/ai/model-cache";
import { isFixtureMode, modelFor } from "@/lib/ai/provider";
import type { RequestAnalysisResult, AnalyzeInput } from "@/lib/ai/analyze-request";
import type { ScopeExtractionResult } from "@/lib/ai/extract-scope";
import {
  confirmScope,
  createProject,
  createScopeDocument,
  getScopeState,
  replaceScopeItems,
} from "@/lib/data/projects";
import {
  createChangeRequest,
  inputHash,
  markAnalysisRunFixture,
  recordEvent,
  saveAnalysis,
  startAnalysisRun,
} from "@/lib/data/requests";
import { createClient } from "@/lib/supabase/server";
import {
  SAMPLE_CLIENT_MESSAGE,
  SAMPLE_PROJECT,
  SAMPLE_REQUEST_TITLE,
  SAMPLE_SCOPE_TEXT,
  SAMPLE_SCOPE_TITLE,
} from "@/lib/sample/sample-project";
import { PROMPT_VERSIONS } from "@/lib/ai/prompts";

export interface SeedResult {
  projectId: string;
  changeRequestId: string;
}

/** Remove any existing sample project for this user. */
export async function clearSample(userId: string): Promise<void> {
  const supabase = await createClient();

  await supabase
    .from("projects")
    .delete()
    .eq("owner_id", userId)
    .eq("is_sample", true);
}

/**
 * Build the sample project end to end: project, scope, confirmed baseline,
 * change request, and a completed analysis.
 */
export async function seedSample(userId: string): Promise<SeedResult> {
  await clearSample(userId);

  // The sample's model inputs are compile-time constants, so the first
  // visitor's VERIFIED live output can serve everyone after them (see
  // lib/ai/model-cache.ts). Real user calls never pass a cache.
  const cache = createModelCache();

  const project = await createProject(userId, {
    name: SAMPLE_PROJECT.name,
    clientName: SAMPLE_PROJECT.clientName,
    description: SAMPLE_PROJECT.description,
    currency: SAMPLE_PROJECT.currency,
    defaultRate: SAMPLE_PROJECT.defaultRate,
    isSample: true,
  });

  const locators = buildParagraphLocators(SAMPLE_SCOPE_TEXT);

  const { version } = await createScopeDocument(userId, project.id, {
    title: SAMPLE_SCOPE_TITLE,
    text: SAMPLE_SCOPE_TEXT,
    locators,
  });

  // Run the real extraction so the sample's citations are genuinely verified.
  // The live model occasionally returns a quote that fails verification even
  // after generate()'s one retry — a real user sees a failed run and retries,
  // but the demo must seed deterministically. So: try the live path, and on
  // failure fall back to the fixture engine, whose quotes are verbatim by
  // construction and go through the same verification. The fallback is
  // recorded below, never passed off as model output.
  let extraction: ScopeExtractionResult;
  try {
    extraction = await extractScope(SAMPLE_SCOPE_TEXT, locators, cache);
  } catch {
    extraction = extractScopeFixture(SAMPLE_SCOPE_TEXT, locators);
  }
  const extractionFellBack = !isFixtureMode() && extraction.fixture;

  await replaceScopeItems(
    userId,
    version.id,
    extraction.items.map((item) => ({
      category: item.category,
      description: item.description,
      sourceQuote: item.sourceQuote,
      sourceLocator: item.sourceLocator,
      quoteStart: item.quoteStart,
      quoteEnd: item.quoteEnd,
      userAdded: false,
    })),
  );

  await confirmScope(userId, version.id);
  await recordEvent(userId, {
    projectId: project.id,
    event: "Scope confirmed",
    actor: "system",
    note: `Baseline version ${version.version} confirmed for the sample project.${
      extractionFellBack
        ? " Extraction fell back to the deterministic engine after the model's citations failed verification."
        : extraction.usage.cached
          ? " Served from the sample's verified model cache (first live run)."
          : ""
    }`,
  });

  const request = await createChangeRequest(userId, {
    projectId: project.id,
    scopeVersionId: version.id,
    title: SAMPLE_REQUEST_TITLE,
    clientMessage: SAMPLE_CLIENT_MESSAGE,
    receivedOn: new Date().toISOString().slice(0, 10),
    sourceLabel: "email",
    idempotencyKey: `sample-${userId}-${Date.now()}`,
  });

  // Run the real analysis too, so the review screen shows genuine output.
  // Same fallback contract as extraction above: the demo must always seed,
  // and the run row is corrected to fixture mode so the review screen says
  // where the assessment came from.
  const state = await getScopeState(userId, project.id);

  const run = await startAnalysisRun(userId, request.id, {
    model: isFixtureMode() ? "fixture" : modelFor("analyze"),
    promptVersion: PROMPT_VERSIONS.analyze_request,
    inputHash: inputHash({
      clientMessage: SAMPLE_CLIENT_MESSAGE,
      scopeVersionId: version.id,
      userContext: null,
      promptVersion: PROMPT_VERSIONS.analyze_request,
    }),
    fixtureMode: isFixtureMode(),
  });

  const analysisInput: AnalyzeInput = {
    clientMessage: SAMPLE_CLIENT_MESSAGE,
    documentText: SAMPLE_SCOPE_TEXT,
    locators,
    scopeItems: state.items,
    userContext: null,
  };

  let analysis: RequestAnalysisResult;
  try {
    analysis = await analyzeRequest(analysisInput, cache);
  } catch {
    analysis = analyzeRequestFixture(analysisInput);
    await markAnalysisRunFixture(userId, run.id);
  }
  const analysisFellBack = !isFixtureMode() && analysis.fixture;

  await saveAnalysis(userId, request.id, run.id, analysis.items, {
    inputTokens: analysis.usage.inputTokens,
    outputTokens: analysis.usage.outputTokens,
    durationMs: analysis.usage.durationMs,
  });

  await recordEvent(userId, {
    projectId: project.id,
    changeRequestId: request.id,
    event: "Analysis completed",
    actor: "system",
    note: `${analysis.items.length} request items assessed against baseline version ${version.version}.${
      analysisFellBack
        ? " Assessment fell back to the deterministic engine after the model's citations failed verification."
        : analysis.usage.cached
          ? " Served from the sample's verified model cache (first live run)."
          : ""
    }`,
  });

  return { projectId: project.id, changeRequestId: request.id };
}
