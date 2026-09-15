/**
 * Operation C — draft the client reply and change-order narrative (plan §5, §9).
 *
 * The model writes prose only. Totals, dates, identifiers and the estimate
 * table are rendered from stored records by lib/documents/render.ts, so
 * "numeric details come from stored application data" is structural rather
 * than something the prompt has to be trusted about.
 *
 * Generated prose is additionally scanned for figures and legal claims. If the
 * model slips a price or a deadline into narrative text, that is a validation
 * failure and triggers the one retry — the same machinery used for bad
 * citations.
 */

import "server-only";

import { fixtureDocumentDraft } from "./fixtures.ts";
import { generate, type ModelResult } from "./provider.ts";
import {
  DRAFT_DOCUMENTS_SYSTEM,
  draftDocumentsUser,
  findLegalClaims,
  findMonetaryClaims,
  PROMPT_VERSIONS,
} from "./prompts.ts";
import { DocumentDraftSchema, type DocumentDraft } from "./schemas.ts";
import type { AssessmentLabel, Tone } from "../types.ts";

export interface DraftInput {
  projectName: string;
  clientName: string | null;
  tone: Tone;
  /** Items keyed by the user's FINAL label, not the model's proposal. */
  items: Array<{ title: string; label: AssessmentLabel; question: string | null }>;
  workDescriptions: string[];
  hasEstimate: boolean;
}

export interface DraftResult {
  sections: DocumentDraft;
  model: string;
  promptVersion: string;
  fixture: boolean;
  /** Non-null when a figure or legal claim was found and stripped. */
  warnings: string[];
  usage: ModelResult<unknown>["usage"];
}

export async function draftDocuments(input: DraftInput): Promise<DraftResult> {  const byLabel = (label: AssessmentLabel) =>
    input.items.filter((item) => item.label === label).map((item) => item.title);

  const included = byLabel("included");
  const additional = byLabel("potentially_additional");
  const clarification = byLabel("needs_clarification");

  const clarificationText = input.items
    .filter((item) => item.label === "needs_clarification")
    .map((item) => `- ${item.title}${item.question ? ` (ask: ${item.question})` : ""}`)
    .join("\n");

  const result = await generate({
    operation: "draft",
    system: DRAFT_DOCUMENTS_SYSTEM,
    user: draftDocumentsUser({
      projectName: input.projectName,
      clientName: input.clientName,
      tone: input.tone,
      includedText: included.map((title) => `- ${title}`).join("\n"),
      additionalText: additional.map((title) => `- ${title}`).join("\n"),
      clarificationText,
      workText: input.workDescriptions.map((description) => `- ${description}`).join("\n"),
      hasEstimate: input.hasEstimate,
    }),
    schema: DocumentDraftSchema,
    schemaName: "document_draft",
    fixture: () =>
      fixtureDocumentDraft({
        clientName: input.clientName,
        tone: input.tone,
        included,
        additional,
        clarification,
        hasEstimate: input.hasEstimate,
      }),
    validate: (data) => {
      for (const [section, text] of Object.entries(data)) {
        const figures = findMonetaryClaims(text);
        if (figures.length) {
          return `Section "${section}" contains ${figures.join(" and ")}. The application renders all figures and dates from its own records — remove them from your prose and refer to "the breakdown below" instead.`;
        }

        const legal = findLegalClaims(text);
        if (legal.length) {
          return `Section "${section}" makes a legal claim ("${legal[0]}"). Describe the scope difference factually without asserting breach, liability, or enforceability.`;
        }
      }
      return null;
    },
  });

  /*
   * Belt and braces. The retry above usually fixes a stray figure, but if the
   * second attempt still contains one we must not display it: a number in
   * narrative prose could contradict the deterministic estimate table sitting
   * directly beneath it. We drop the offending section and tell the user, which
   * is recoverable — a wrong number quietly sent to a client is not.
   */
  const sections = { ...result.data };
  const warnings: string[] = [];

  for (const key of Object.keys(sections) as Array<keyof DocumentDraft>) {
    const text = sections[key];
    const figures = findMonetaryClaims(text);
    const legal = findLegalClaims(text);

    if (figures.length || legal.length) {
      sections[key] = "";
      warnings.push(
        `The “${key.replace(/_/g, " ")}” section was cleared because the draft contained ${
          figures.length ? figures.join(" and ") : `a legal claim ("${legal[0]}")`
        }. Please write this section yourself.`,
      );
    }
  }

  return {
    sections,
    model: result.model,
    promptVersion: PROMPT_VERSIONS.draft_documents,
    fixture: result.fixture,
    warnings,
    usage: result.usage,
  };
}
