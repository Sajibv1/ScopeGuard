/**
 * Operation A, no-source variant (plan §5, §10 Tier 2): structure the user's
 * rough notes about a call.
 *
 * Every other extraction path ends in citation verification — a quote that
 * does not appear verbatim in the source is rejected. This path has no
 * source to verify against, and that is the point: the notes are the user's
 * own memory, and memory is not evidence. The output schema carries no quote
 * fields, so nothing here can masquerade as a quoted commitment. The items
 * are stored as provenance "memory", visibly unverified, and only a later
 * client reply — ingested as a real document — can confirm them.
 */

import "server-only";

import { generate, type ModelCache, type ModelResult } from "./provider.ts";
import { fixtureNotesExtraction } from "./fixtures.ts";
import { EXTRACT_NOTES_SYSTEM, extractNotesUser, PROMPT_VERSIONS } from "./prompts.ts";
import { NotesScopeExtractionSchema } from "./schemas.ts";
import type { ScopeCategory } from "../types.ts";

export interface NoteItem {
  category: ScopeCategory;
  description: string;
}

export interface NotesExtractionResult {
  items: NoteItem[];
  model: string;
  promptVersion: string;
  fixture: boolean;
  usage: ModelResult<unknown>["usage"];
}

export async function extractScopeFromNotes(
  notesText: string,
  cache?: ModelCache,
): Promise<NotesExtractionResult> {
  const result = await generate({
    operation: "extract",
    system: EXTRACT_NOTES_SYSTEM,
    user: extractNotesUser(notesText),
    schema: NotesScopeExtractionSchema,
    schemaName: "notes_scope_extraction",
    cache,
    fixture: () => fixtureNotesExtraction(notesText),
    // No citation validation: there is nothing to cite. The schema itself is
    // the guard — quote fields do not exist in it, so any the model tries to
    // add are stripped before this function returns.
  });

  return {
    items: result.data.items,
    model: result.model,
    promptVersion: PROMPT_VERSIONS.extract_scope_notes,
    fixture: result.fixture,
    usage: result.usage,
  };
}
