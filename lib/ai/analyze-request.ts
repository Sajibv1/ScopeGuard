/**
 * Operation B — decompose the client message and compare it to the baseline
 * (plan §5, §6). This is the product's primary differentiator, so it carries
 * the most validation.
 *
 * Three things happen after the model responds:
 *
 *  1. Every scope citation is verified against the source document. Failures
 *     are recorded, not hidden.
 *  2. Every request excerpt is verified against the CLIENT MESSAGE, so an item
 *     cannot be traced to text the client never wrote.
 *  3. The "absence is not exclusion" rule is enforced in code, not just asked
 *     for in the prompt: an item labelled "potentially_additional" with no
 *     verified supporting evidence is downgraded to "needs_clarification".
 *
 * That third step is the one that matters most. A prompt instruction is a
 * request; this is a guarantee.
 */

import "server-only";

import { normalize, verifyEvidenceList, verifyQuote, type NormalizedText } from "./citations.ts";
import { fixtureRequestAnalysis } from "./fixtures.ts";
import { generate, type ModelCache, type ModelResult } from "./provider.ts";
import {
  ANALYZE_REQUEST_SYSTEM,
  analyzeRequestUser,
  PROMPT_VERSIONS,
} from "./prompts.ts";
import { RequestAnalysisSchema, type RequestAnalysis } from "./schemas.ts";
import { SCOPE_CATEGORY_LABELS, type AssessmentLabel, type Evidence, type Locator, type ScopeItem } from "../types.ts";

export interface AnalyzedItem {
  title: string;
  description: string;
  sourceExcerpt: string;
  excerptStart: number | null;
  excerptEnd: number | null;
  proposedLabel: AssessmentLabel;
  explanation: string;
  supportingEvidence: Evidence[];
  conflictingEvidence: Evidence[];
  missingInformation: string[];
  suggestedQuestion: string | null;
  validationFailed: boolean;
  validationNotes: string | null;
}

export interface RequestAnalysisResult {
  items: AnalyzedItem[];
  model: string;
  promptVersion: string;
  fixture: boolean;
  usage: ModelResult<unknown>["usage"];
}

export interface AnalyzeInput {
  clientMessage: string;
  documentText: string;
  locators: Locator[];
  scopeItems: ScopeItem[];
  userContext: string | null;
}

/**
 * Enforce the plan's central evidence rule (§6) in code.
 *
 * "Included" and "potentially additional" are both claims about what the
 * document says, so each requires at least one VERIFIED supporting quote.
 * When the model's citation did not survive verification, the honest
 * remaining state is "needs clarification" — never the stronger label on no
 * evidence. Absence from the document is not proof of exclusion.
 *
 * Exported and pure so the guarantee can be tested without a model call: a
 * prompt instruction is a request, this is the guarantee.
 */
export function applyEvidenceRules(input: {
  label: AssessmentLabel;
  explanation: string;
  missingInformation: string[];
  verifiedSupportingCount: number;
}): {
  label: AssessmentLabel;
  explanation: string;
  missingInformation: string[];
  notes: string[];
} {
  const notes: string[] = [];
  const missingInformation = [...input.missingInformation];
  let label = input.label;
  let explanation = input.explanation;

  if (input.verifiedSupportingCount > 0 || label === "needs_clarification") {
    return { label, explanation, missingInformation, notes };
  }

  if (label === "potentially_additional") {
    label = "needs_clarification";
    notes.push(
      "Downgraded from “potentially additional” to “needs clarification”: no verified scope quote supported the stronger label.",
    );
    missingInformation.push("A scope clause that addresses this request");
    explanation = `${explanation.trim()} The agreement does not verifiably address this, and absence from the document is not itself evidence that the work is out of scope.`;
  } else if (label === "included") {
    label = "needs_clarification";
    notes.push(
      "Downgraded from “included” to “needs clarification”: no verified scope quote supported the stronger label.",
    );
    missingInformation.push("A scope clause confirming this is covered");
    explanation = `${explanation.trim()} No clause in the agreement verifiably covers this.`;
  }

  return { label, explanation, missingInformation, notes };
}

export async function analyzeRequest(
  input: AnalyzeInput,
  cache?: ModelCache,
): Promise<RequestAnalysisResult> {
  const normalizedDoc = normalize(input.documentText);
  const normalizedMessage = normalize(input.clientMessage);

  const messageLocators: Locator[] = [
    { id: "msg", kind: "paragraph", label: "Client message", start: 0, end: input.clientMessage.length },
  ];

  const result = await generate({    operation: "analyze",
    cache,
    system: ANALYZE_REQUEST_SYSTEM,
    user: analyzeRequestUser({
      scopeItemsText: renderScopeItems(input.scopeItems),
      documentText: input.documentText,
      locatorGuide: renderLocatorGuide(input.locators, input.documentText),
      clientMessage: input.clientMessage,
      userContext: input.userContext,
    }),
    schema: RequestAnalysisSchema,
    schemaName: "request_analysis",
    fixture: () =>
      fixtureRequestAnalysis(input.clientMessage, input.scopeItems, input.userContext),
    validate: (data) => {
      if (data.items.length === 0) {
        return "You returned no request items. A client message always contains at least one request; if it is purely conversational, return one item describing it.";
      }

      // An excerpt that is not in the client message breaks traceability.
      const badExcerpt = data.items.find(
        (item) =>
          !verifyQuote(item.source_excerpt, null, {
            sourceText: input.clientMessage,
            locators: messageLocators,
            normalized: normalizedMessage,
          }).ok,
      );

      if (badExcerpt) {
        return `The source_excerpt for "${badExcerpt.title}" does not appear verbatim in the client message. Copy exact text from between the CLIENT MESSAGE markers.`;
      }

      // Catch the cardinal error while a retry is still cheap.
      const unsupported = data.items.find(
        (item) => item.label === "potentially_additional" && item.supporting_evidence.length === 0,
      );

      if (unsupported) {
        return `You labelled "${unsupported.title}" as potentially_additional with no supporting quote. That label requires citing an explicit exclusion, a stated limit, or a defined deliverable. If the agreement is simply silent on this, the correct label is needs_clarification.`;
      }

      return null;
    },
  });

  const items = processAnalysisItems(result.data, input, { normalizedDoc, normalizedMessage, messageLocators });

  return {
    items,
    model: result.model,
    promptVersion: PROMPT_VERSIONS.analyze_request,
    fixture: result.fixture,
    usage: result.usage,
  };
}

/**
 * Deterministic analysis used as the sample seed's fallback when the live
 * model's output cannot be verified even after its retry.
 *
 * The result goes through processAnalysisItems — the same verification and
 * the same "absence is not exclusion" downgrade as live output — and is
 * marked `fixture: true` so anything recording or displaying it can say
 * where it came from. Demo-seed safety net only: a real user's failed
 * analysis still surfaces as a failed run (see generate()'s contract).
 */
export function analyzeRequestFixture(input: AnalyzeInput): RequestAnalysisResult {
  const normalizedDoc = normalize(input.documentText);
  const normalizedMessage = normalize(input.clientMessage);

  const messageLocators: Locator[] = [
    { id: "msg", kind: "paragraph", label: "Client message", start: 0, end: input.clientMessage.length },
  ];

  const data = fixtureRequestAnalysis(input.clientMessage, input.scopeItems, input.userContext);
  const items = processAnalysisItems(data, input, { normalizedDoc, normalizedMessage, messageLocators });

  return {
    items,
    model: "fixture",
    promptVersion: PROMPT_VERSIONS.analyze_request,
    fixture: true,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0, attempts: 1 },
  };
}

/**
 * Turn raw (schema-shaped) analysis output into AnalyzedItems: verify every
 * excerpt against the client message, verify every citation against the
 * document, strip what fails, and enforce the evidence rules in code.
 */
function processAnalysisItems(
  data: RequestAnalysis,
  input: AnalyzeInput,
  ctx: {
    normalizedDoc: NormalizedText;
    normalizedMessage: NormalizedText;
    messageLocators: Locator[];
  },
): AnalyzedItem[] {
  return data.items.map((raw): AnalyzedItem => {
    const excerptCheck = verifyQuote(raw.source_excerpt, null, {
      sourceText: input.clientMessage,
      locators: ctx.messageLocators,
      normalized: ctx.normalizedMessage,
    });

    const supporting = verifyEvidenceList(
      raw.supporting_evidence.map((claim) => ({ ...claim, scopeItemId: matchScopeItem(claim.quote, input.scopeItems) })),
      { sourceText: input.documentText, locators: input.locators, normalized: ctx.normalizedDoc },
    );

    const conflicting = verifyEvidenceList(
      raw.conflicting_evidence.map((claim) => ({ ...claim, scopeItemId: matchScopeItem(claim.quote, input.scopeItems) })),
      { sourceText: input.documentText, locators: input.locators, normalized: ctx.normalizedDoc },
    );

    const notes: string[] = [];
    for (const entry of [...supporting.rejected, ...conflicting.rejected]) {
      notes.push(`Unverified citation removed — ${entry.reason} ("${truncate(entry.quote, 80)}")`);
    }

    const rules = applyEvidenceRules({
      label: raw.label,
      explanation: raw.explanation,
      missingInformation: raw.missing_information,
      verifiedSupportingCount: supporting.evidence.length,
    });

    notes.push(...rules.notes);

    return {
      title: raw.title,
      description: raw.description,
      sourceExcerpt: excerptCheck.originalQuote ?? raw.source_excerpt,
      excerptStart: excerptCheck.start ?? null,
      excerptEnd: excerptCheck.end ?? null,
      proposedLabel: rules.label,
      explanation: rules.explanation,
      supportingEvidence: supporting.evidence,
      conflictingEvidence: conflicting.evidence,
      missingInformation: [...new Set(rules.missingInformation)],
      suggestedQuestion: raw.suggested_question,
      validationFailed: notes.length > 0,
      validationNotes: notes.length ? notes.join("\n") : null,
    };
  });
}

function renderScopeItems(items: ScopeItem[]): string {
  if (items.length === 0) return "(no confirmed scope items)";

  return items
    .map((item) => {
      const evidence = item.userAdded
        ? `[developer-supplied context, NOT document text: do not quote as scope evidence]`
        : `quote: "${item.sourceQuote}" (${item.sourceLocator})`;
      return `- [${SCOPE_CATEGORY_LABELS[item.category]}] ${item.description}\n  ${evidence}`;
    })
    .join("\n");
}

function renderLocatorGuide(locators: Locator[], text: string): string {
  return locators
    .map((locator) => {
      const preview = text.slice(locator.start, locator.start + 90).replace(/\s+/g, " ");
      return `- ${locator.label}: "${preview}${locator.end - locator.start > 90 ? "..." : ""}"`;
    })
    .join("\n");
}

/** Link a verified quote back to the scope item it belongs to, if any. */
function matchScopeItem(quote: string, items: ScopeItem[]): string | undefined {
  const needle = normalize(quote).text;
  if (!needle) return undefined;

  for (const item of items) {
    if (!item.sourceQuote) continue;
    const hay = normalize(item.sourceQuote).text;
    if (hay.includes(needle) || needle.includes(hay)) return item.id;
  }
  return undefined;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
