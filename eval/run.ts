/**
 * Evaluation harness (plan §6).
 *
 * Runs every labelled case through the real analysis pipeline and reports the
 * metrics the plan asks for: label agreement, citation validation pass rate,
 * missed or invented items, latency and cost.
 *
 * Run with:
 *   npm run eval              # fixture mode unless OPENAI_API_KEY is set
 *   npm run eval -- --live    # require a live model
 *   npm run eval -- --case inj-in-document
 *
 * The headline number is not accuracy. It is the "absence is not exclusion"
 * violation count: cases where the system asserted a stronger label than the
 * evidence supports. A single such violation is worse than several honest
 * "needs clarification" answers, so it is reported separately and loudly.
 */

import { analyzeRequest } from "../lib/ai/analyze-request.ts";
import { buildParagraphLocators, verifyQuote } from "../lib/ai/citations.ts";
import { isFixtureMode, modelFor } from "../lib/ai/provider.ts";
import type { AssessmentLabel, ScopeItem } from "../lib/types.ts";
import { CASES, datasetSummary, SCOPES, type EvalCase } from "./cases.ts";

interface CaseResult {
  id: string;
  category: string;
  passed: boolean;
  itemCountOk: boolean;
  labelsOk: boolean;
  noForbiddenLabel: boolean;
  questionOk: boolean;
  citationsOk: boolean;
  actualLabels: AssessmentLabel[];
  actualCount: number;
  failures: string[];
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

async function main() {
  const args = process.argv.slice(2);
  const only = valueOf(args, "--case");
  const requireLive = args.includes("--live");

  if (requireLive && isFixtureMode()) {
    console.error("--live was passed but OPENAI_API_KEY is not set.");
    process.exit(1);
  }

  const fixture = isFixtureMode();
  const cases = only ? CASES.filter((entry) => entry.id === only) : CASES;

  if (cases.length === 0) {
    console.error(`No case matched "${only}".`);
    process.exit(1);
  }

  console.log("ScopeGuard evaluation");
  console.log("=".repeat(72));
  console.log(`Mode      ${fixture ? "FIXTURE (deterministic stand-in)" : `LIVE — ${modelFor("analyze")}`}`);
  console.log(`Cases     ${cases.length}`);
  console.log(
    `Coverage  ${Object.entries(datasetSummary())
      .map(([key, count]) => `${key}:${count}`)
      .join("  ")}`,
  );
  console.log("=".repeat(72));
  console.log();

  const results: CaseResult[] = [];

  for (const testCase of cases) {
    const result = await runCase(testCase);
    results.push(result);

    const mark = result.passed ? "PASS" : "FAIL";
    console.log(
      `${mark}  ${testCase.id.padEnd(22)} ${testCase.category.padEnd(16)} ${result.actualLabels.map(short).join(",") || "(none)"}`,
    );

    for (const failure of result.failures) {
      console.log(`      ${failure}`);
    }
  }

  report(results, fixture);
}

async function runCase(testCase: EvalCase): Promise<CaseResult> {
  const scope = SCOPES.find((entry) => entry.id === testCase.scopeId)!;
  const locators = buildParagraphLocators(scope.text);
  const scopeItems = deriveScopeItems(scope.text, locators);

  const started = Date.now();

  const analysis = await analyzeRequest({
    clientMessage: testCase.message,
    documentText: scope.text,
    locators,
    scopeItems,
    userContext: testCase.userContext ?? null,
  });

  const failures: string[] = [];
  const actualLabels = analysis.items.map((item) => item.proposedLabel);

  // Item count. Allowing ±0 is too strict for decomposition, so a case passes
  // if it finds the expected number; anything else is reported precisely.
  const itemCountOk = analysis.items.length === testCase.expectedItemCount;
  if (!itemCountOk) {
    failures.push(
      `items: expected ${testCase.expectedItemCount}, got ${analysis.items.length}`,
    );
  }

  /*
   * Label agreement. `expectedLabels` lists one label per expected item, but
   * for single-item cases with two defensible answers it may list both — so
   * compare as a set membership per item rather than positionally when the
   * lengths disagree.
   */
  let labelsOk: boolean;
  if (testCase.expectedItemCount === 1) {
    labelsOk =
      actualLabels.length === 1 && testCase.expectedLabels.includes(actualLabels[0]!);
  } else {
    labelsOk =
      actualLabels.length === testCase.expectedLabels.length &&
      actualLabels.every((label, index) => label === testCase.expectedLabels[index]);
  }

  if (!labelsOk) {
    failures.push(
      `labels: expected ${testCase.expectedLabels.map(short).join("|")}, got ${actualLabels.map(short).join(",") || "none"}`,
    );
  }

  // The rule that matters most.
  const forbidden = testCase.mustNotAssert ?? [];
  const violations = analysis.items.filter((item) => forbidden.includes(item.proposedLabel));
  const noForbiddenLabel = violations.length === 0;

  if (!noForbiddenLabel) {
    failures.push(
      `EVIDENCE VIOLATION: asserted ${violations.map((item) => short(item.proposedLabel)).join(",")} where it must not`,
    );
  }

  // Suggested question.
  let questionOk = true;
  if (testCase.expectQuestionMatching) {
    const questions = analysis.items
      .flatMap((item) => [item.suggestedQuestion ?? "", ...item.missingInformation])
      .join(" ");
    questionOk = testCase.expectQuestionMatching.test(questions);
    if (!questionOk) {
      failures.push(`question: nothing matched ${testCase.expectQuestionMatching}`);
    }
  }

  /*
   * Citation validation. Every displayed quote must independently re-verify
   * against the source. This is checked here as well as in the pipeline
   * because the pipeline's own check is the thing under test.
   */
  let citationsOk = true;
  for (const item of analysis.items) {
    for (const evidence of [...item.supportingEvidence, ...item.conflictingEvidence]) {
      const check = verifyQuote(evidence.quote, evidence.locator, {
        sourceText: scope.text,
        locators,
      });
      if (!check.ok) {
        citationsOk = false;
        failures.push(`citation failed re-verification: "${evidence.quote.slice(0, 50)}…"`);
      }
    }
  }

  // A strong label with no supporting evidence should be impossible.
  for (const item of analysis.items) {
    if (item.proposedLabel !== "needs_clarification" && item.supportingEvidence.length === 0) {
      citationsOk = false;
      failures.push(`"${short(item.proposedLabel)}" asserted with zero verified evidence`);
    }
  }

  return {
    id: testCase.id,
    category: testCase.category,
    passed: itemCountOk && labelsOk && noForbiddenLabel && questionOk && citationsOk,
    itemCountOk,
    labelsOk,
    noForbiddenLabel,
    questionOk,
    citationsOk,
    actualLabels,
    actualCount: analysis.items.length,
    failures,
    durationMs: Date.now() - started,
    costUsd: analysis.usage.costUsd ?? 0,
    inputTokens: analysis.usage.inputTokens,
    outputTokens: analysis.usage.outputTokens,
  };
}

/**
 * Derive baseline scope items from the document.
 *
 * The eval feeds the analyser real, verifiable scope items without depending
 * on a database, by quoting each paragraph in full. Quoting whole paragraphs
 * means every item's citation is verbatim by construction, so the eval tests
 * the COMPARISON step rather than the extraction step.
 */
function deriveScopeItems(
  text: string,
  locators: ReturnType<typeof buildParagraphLocators>,
): ScopeItem[] {
  return locators.map((locator, index) => {
    const quote = text.slice(locator.start, locator.end).trim();
    const lower = quote.toLowerCase();

    let category: ScopeItem["category"] = "included_functionality";
    if (/exclud|not included|are not/.test(lower)) category = "exclusion";
    else if (/revision|round/.test(lower)) category = "revision_limit";
    else if (/up to|maximum|no more than/.test(lower)) category = "quantity_limit";
    else if (/client will provide|provided by the client/.test(lower)) {
      category = "client_responsibility";
    } else if (/approval|before implementation/.test(lower)) category = "milestone";
    else if (/only|english/.test(lower)) category = "constraint";

    return {
      id: `scope-${index}`,
      scopeVersionId: "eval",
      category,
      description: quote.slice(0, 160),
      sourceQuote: quote,
      sourceLocator: locator.label,
      quoteStart: locator.start,
      quoteEnd: locator.start + quote.length,
      userAdded: false,
      commitment: null,
      provenance: "document" as const,
      confirmed: true,
      sortOrder: index,
    };
  });
}

function report(results: CaseResult[], fixture: boolean) {
  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const labelAgreement = results.filter((result) => result.labelsOk).length;
  const citationPass = results.filter((result) => result.citationsOk).length;
  const decomposition = results.filter((result) => result.itemCountOk).length;
  const violations = results.filter((result) => !result.noForbiddenLabel);

  const totalCost = results.reduce((sum, result) => sum + result.costUsd, 0);
  const totalMs = results.reduce((sum, result) => sum + result.durationMs, 0);
  const inputTokens = results.reduce((sum, result) => sum + result.inputTokens, 0);
  const outputTokens = results.reduce((sum, result) => sum + result.outputTokens, 0);

  console.log();
  console.log("=".repeat(72));
  console.log("Results");
  console.log("=".repeat(72));
  console.log(`Cases passed          ${passed}/${total}  (${pct(passed, total)})`);
  console.log(`Label agreement       ${labelAgreement}/${total}  (${pct(labelAgreement, total)})`);
  console.log(`Citation validation   ${citationPass}/${total}  (${pct(citationPass, total)})`);
  console.log(`Correct decomposition ${decomposition}/${total}  (${pct(decomposition, total)})`);
  console.log();

  // The metric the product lives or dies by.
  if (violations.length === 0) {
    console.log("Evidence rule         0 violations");
    console.log("                      No case asserted a label the evidence could not support.");
  } else {
    console.log(`Evidence rule         ${violations.length} VIOLATION(S)`);
    for (const violation of violations) {
      console.log(`                      ${violation.id}: ${violation.actualLabels.map(short).join(",")}`);
    }
  }

  console.log();
  console.log(`Latency               ${(totalMs / total).toFixed(0)} ms mean, ${totalMs} ms total`);

  if (!fixture) {
    console.log(`Tokens                ${inputTokens} in, ${outputTokens} out`);
    console.log(`Cost                  $${totalCost.toFixed(4)} total, $${(totalCost / total).toFixed(4)} per case`);
  }

  console.log();
  console.log("By category");
  const categories = [...new Set(results.map((result) => result.category))];
  for (const category of categories) {
    const subset = results.filter((result) => result.category === category);
    const subsetPassed = subset.filter((result) => result.passed).length;
    console.log(
      `  ${category.padEnd(18)} ${subsetPassed}/${subset.length}  ${pct(subsetPassed, subset.length)}`,
    );
  }

  console.log();
  if (fixture) {
    console.log(
      "Note: fixture mode measures the pipeline and its safeguards, not model quality.\n" +
        "Set OPENAI_API_KEY and re-run to evaluate the model.",
    );
    console.log();
  }

  /*
   * Exit code.
   *
   * Safety invariants are the pipeline's own guarantees and must hold in
   * every mode: no unverifiable citation is ever displayed, no strong label
   * is ever asserted without verified evidence, and no forbidden label
   * appears. A regression in any of those is a build-breaking bug.
   *
   * Label agreement is a MODEL quality measure. In fixture mode the analyser
   * is a keyword matcher, so holding it to the model's bar would either fail
   * the build permanently or tempt someone to tune the fixture against the
   * eval set — which would make the number meaningless. It is reported in
   * both modes and enforced only when a real model is answering.
   */
  const safetyOk = violations.length === 0 && citationPass === total;
  const failed = fixture ? !safetyOk : !safetyOk || passed < total;

  if (fixture && safetyOk && passed < total) {
    console.log(
      "Label agreement below 100% in fixture mode is expected: the offline\n" +
        "stand-in is a keyword matcher, not a language model. Safety invariants\n" +
        "all held, so this run passes.",
    );
    console.log();
  }

  process.exit(failed ? 1 : 0);
}

function short(label: AssessmentLabel): string {
  return { included: "INC", potentially_additional: "ADD", needs_clarification: "CLR" }[label];
}

function pct(value: number, total: number): string {
  return total === 0 ? "n/a" : `${((value / total) * 100).toFixed(0)}%`;
}

function valueOf(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1]! : null;
}

main().catch((error) => {
  console.error("Evaluation failed to run:", error);
  process.exit(1);
});
