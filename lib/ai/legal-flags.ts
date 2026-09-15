/**
 * Legal topic flags (§8 "automatic legal conclusions", honest version).
 *
 * The refusal was to the machine CONCLUDING anything legal. This module is
 * the opt-in topic pointer: it names contract-adjacent subjects the change
 * request touches (indemnification, IP ownership, warranties…) and says why
 * a professional might look at them. It never asserts breach, liability, or
 * enforceability — and that rule is enforced twice:
 *
 *  1. `validate` rejects the whole response on the retry pass if any note
 *     contains legal-conclusion language.
 *  2. Belt and braces: any flag that still contains such language after the
 *     retry is DROPPED, and the caller is told. A flagged topic the user can
 *     look up themselves is recoverable; a machine-rendered legal conclusion
 *     is the thing this product refuses to produce.
 *
 * Flags are internal: they are never rendered into a reply, change order,
 * invoice, or any export.
 */

import "server-only";

import { fixtureLegalFlags } from "./fixtures.ts";
import { generate, type ModelResult } from "./provider.ts";
import { LEGAL_FLAGS_SYSTEM, legalFlagsUser, findLegalClaims, PROMPT_VERSIONS } from "./prompts.ts";
import { LegalFlagsSchema } from "./schemas.ts";

export interface LegalFlagsInput {
  items: Array<{ title: string; description: string }>;
}

export interface LegalFlagDraft {
  requestItemTitle: string;
  topic: string;
  note: string;
}

export interface LegalFlagsResult {
  flags: LegalFlagDraft[];
  /** Non-empty when flags were dropped for containing legal conclusions. */
  warnings: string[];
  model: string;
  promptVersion: string;
  fixture: boolean;
  usage: ModelResult<unknown>["usage"];
}

export async function flagLegalTopics(input: LegalFlagsInput): Promise<LegalFlagsResult> {
  const result = await generate({
    operation: "legal",
    system: LEGAL_FLAGS_SYSTEM,
    user: legalFlagsUser(
      input.items
        .map((item) => `- ${item.title}: ${item.description}`)
        .join("\n"),
    ),
    schema: LegalFlagsSchema,
    schemaName: "legal_flags",
    fixture: () => fixtureLegalFlags(input.items),
    validate: (data) => {
      for (const flag of data.flags) {
        const claims = findLegalClaims(`${flag.topic}. ${flag.note}`);
        if (claims.length) {
          return `Flag "${flag.topic}" contains a legal conclusion ("${claims[0]}"). Name the topic and describe it neutrally — do not assert breach, liability, or enforceability.`;
        }
      }
      return null;
    },
  });

  // Belt and braces, same as draft-documents: if the retry still produced
  // conclusion language, that flag does not get shown. Ever.
  const flags: LegalFlagDraft[] = [];
  const warnings: string[] = [];

  for (const flag of result.data.flags) {
    const claims = findLegalClaims(`${flag.topic}. ${flag.note}`);
    if (claims.length) {
      warnings.push(
        `A flag on "${flag.topic}" was dropped because its note read as a legal conclusion ("${claims[0]}").`,
      );
      continue;
    }
    // Schema fields are snake_case (wire format); callers get camelCase.
    flags.push({
      requestItemTitle: flag.request_item_title,
      topic: flag.topic,
      note: flag.note,
    });
  }

  return {
    flags,
    warnings,
    model: result.model,
    promptVersion: PROMPT_VERSIONS.legal_flags,
    fixture: result.fixture,
    usage: result.usage,
  };
}
