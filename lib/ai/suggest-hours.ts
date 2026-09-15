/**
 * Reference hour drafts (§8 "AI-generated hourly estimates presented as
 * reliable", honest version).
 *
 * The refusal was to AI hours that TOUCH an estimate. This module produces
 * the opt-in draft the work log described: the model's rough figure with a
 * rationale, stored in ai_hour_suggestions and displayed beside the EMPTY
 * hours input. estimate_items.hours is untouched, computeTotals never reads
 * the suggestion, and the user must type their own figure regardless.
 *
 * Structural guarantees, not prompt promises:
 *  - the action only requests drafts for lines whose hours are still NULL
 *  - the output table has no path into estimate_items or any total
 *  - the UI renders suggestions as labelled reference text, never as input
 *    values
 */

import "server-only";

import { fixtureHourSuggestions } from "./fixtures.ts";
import { generate, type ModelResult } from "./provider.ts";
import { HOUR_SUGGESTIONS_SYSTEM, hourSuggestionsUser, PROMPT_VERSIONS } from "./prompts.ts";
import { HourSuggestionsSchema } from "./schemas.ts";

export interface SuggestHoursInput {
  /** Lines the user has not entered hours for yet. */
  lines: Array<{ estimateItemId: string; description: string }>;
}

export interface SuggestHoursResult {
  /** Matched back to estimate lines by the caller. */
  suggestions: Array<{ estimateLine: string; draftHours: number; rationale: string }>;
  model: string;
  promptVersion: string;
  fixture: boolean;
  usage: ModelResult<unknown>["usage"];
}

export async function suggestHours(input: SuggestHoursInput): Promise<SuggestHoursResult> {
  const result = await generate({
    operation: "hours",
    system: HOUR_SUGGESTIONS_SYSTEM,
    user: hourSuggestionsUser(
      input.lines.map((line) => `- ${line.description}`).join("\n"),
    ),
    schema: HourSuggestionsSchema,
    schemaName: "hour_suggestions",
    fixture: () => fixtureHourSuggestions(input.lines),
  });

  return {
    // Schema fields are snake_case (wire format); callers get camelCase.
    suggestions: result.data.suggestions.map((suggestion) => ({
      estimateLine: suggestion.estimate_line,
      draftHours: suggestion.draft_hours,
      rationale: suggestion.rationale,
    })),
    model: result.model,
    promptVersion: PROMPT_VERSIONS.hour_suggestions,
    fixture: result.fixture,
    usage: result.usage,
  };
}
