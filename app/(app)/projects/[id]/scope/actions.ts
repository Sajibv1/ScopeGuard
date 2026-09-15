"use server";

import { revalidatePath } from "next/cache";

import { extractScope } from "@/lib/ai/extract-scope";
import { extractScopeFromNotes } from "@/lib/ai/extract-notes";
import { buildPageLocators } from "@/lib/ai/citations";
import { isFixtureMode } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import {
  confirmScope,
  createDraftVersion,
  createScopeDocument,
  getScopeDocument,
  getScopeState,
  latestMemoryItems,
  replaceScopeItems,
  type ScopeItemInput,
} from "@/lib/data/projects";
import { recordEvent } from "@/lib/data/requests";
import { messageFor, type FormState } from "@/lib/forms";
import { partitionMemoryItems } from "@/lib/scope/memory";
import {
  SCOPE_CATEGORIES,
  TRANSCRIPT_COMMITMENTS,
  type ScopeCategory,
  type TranscriptCommitment,
} from "@/lib/types";
import {
  buildTranscriptDocument,
  transcriptDurationSec,
  TRANSCRIPT_MAX_DURATION_SEC,
  type TranscriptCue,
} from "@/lib/transcript/parse";

export interface ScopeFormState extends FormState {
  rejected?: Array<{ description: string; reason: string }>;
}

/**
 * Carry forward unconfirmed memory items (plan §10, Tier 2).
 *
 * When a real document — the client's reply, or an SOW that finally arrived —
 * is ingested over a notes baseline, remembered items the new document
 * confirms are superseded by extracted items that carry verified quotes.
 * The rest join the new version's items, still provenance "memory", where
 * the review screen flags them: the reply did not confirm these.
 */
async function carryForwardMemoryItems(
  userId: string,
  projectId: string,
  newVersionId: string,
  extracted: Array<{ description: string; sourceQuote: string | null }>,
): Promise<ScopeItemInput[]> {
  const memoryItems = await latestMemoryItems(userId, projectId, newVersionId);
  if (memoryItems.length === 0) return [];

  const { unconfirmed } = partitionMemoryItems(
    memoryItems,
    extracted.map((item) => ({ description: item.description, quote: item.sourceQuote })),
  );

  return unconfirmed.map((item) => ({
    category: item.category,
    description: item.description,
    sourceQuote: null,
    sourceLocator: null,
    quoteStart: null,
    quoteEnd: null,
    userAdded: true,
    provenance: "memory" as const,
  }));
}

/**
 * Save pasted scope text and run extraction.
 *
 * The document row is written BEFORE the model is called (plan §11: "Save
 * inputs before starting analysis"), so a failed extraction leaves the user
 * with their text intact and a retry button rather than an empty form.
 */
export async function ingestScopeAction(
  projectId: string,
  _prev: ScopeFormState,
  formData: FormData,
): Promise<ScopeFormState> {
  const user = await requireUser();

  const title = String(formData.get("title") ?? "").trim() || "Statement of work";
  const text = String(formData.get("text") ?? "");

  let versionId: string;
  let documentText: string;
  let locators;

  try {
    const { document, version } = await createScopeDocument(user.id, projectId, {
      title,
      text,
    });
    versionId = version.id;
    documentText = document.extractedText;
    locators = document.locators;
  } catch (error) {
    return { error: messageFor(error) };
  }

  try {
    const extraction = await extractScope(documentText, locators);

    // A paste over a notes baseline is usually the client's confirming
    // reply — remembered items it does not confirm carry forward, flagged.
    const carried = await carryForwardMemoryItems(
      user.id,
      projectId,
      versionId,
      extraction.items,
    );

    await replaceScopeItems(
      user.id,
      versionId,
      [
        ...extraction.items.map((item) => ({
          category: item.category,
          description: item.description,
          sourceQuote: item.sourceQuote,
          sourceLocator: item.sourceLocator,
          quoteStart: item.quoteStart,
          quoteEnd: item.quoteEnd,
          userAdded: false,
        })),
        ...carried,
      ],
    );

    revalidatePath(`/projects/${projectId}/scope`);

    return {
      ok: true,
      rejected: extraction.rejected.length ? extraction.rejected : undefined,
    };
  } catch (error) {
    // The document survived; only extraction failed. The screen offers a retry
    // that does not require re-pasting.
    revalidatePath(`/projects/${projectId}/scope`);
    return {
      error: `Your scope document was saved, but extraction failed: ${messageFor(error)} You can retry without re-pasting.`,
    };
  }
}

/**
 * Commit a reviewed PDF extraction as the scope document.
 *
 * Takes the page array the user just previewed and possibly CORRECTED, and
 * rebuilds page locators from the confirmed text. Locators are derived from
 * the final text rather than the extracted text, so an edit that shifts
 * offsets cannot leave evidence pointing at the wrong span — which is why
 * the preview is page-by-page rather than one editable blob.
 */
export async function ingestPdfAction(
  projectId: string,
  input: {
    title: string;
    pages: string[];
    storagePath: string | null;
    /**
     * Present when the pages are an OCR transcription. The caller must only
     * send this after the user reviewed the transcription on screen — this
     * write is what sets ocr_reviewed_at, and the database CHECK constraint
     * refuses an OCR document without it.
     */
    ocr?: {
      confidence: number;
      /** The machine's own output, kept verbatim as the audit record. */
      machinePages: Array<{ page: number; text: string; confidence: number; characters: number }>;
    };
  },
): Promise<ScopeFormState> {
  const user = await requireUser();

  const pages = input.pages.map((page) => page ?? "");
  if (pages.join("").trim().length === 0) {
    return { error: "The extracted text is empty. Paste the scope text instead." };
  }

  const { text, locators } = buildPageLocators(pages);

  let versionId: string;

  try {
    const { version } = await createScopeDocument(user.id, projectId, {
      title: input.title.trim() || "Statement of work",
      text,
      sourceKind: "pdf",
      locators,
      storagePath: input.storagePath,
      ocr: input.ocr
        ? { confidence: input.ocr.confidence, pages: input.ocr.machinePages }
        : undefined,
    });
    versionId = version.id;
  } catch (error) {
    return { error: messageFor(error) };
  }

  try {
    const extraction = await extractScope(text, locators);

    // An uploaded reply over a notes baseline behaves like a pasted one.
    const carried = await carryForwardMemoryItems(
      user.id,
      projectId,
      versionId,
      extraction.items,
    );

    await replaceScopeItems(
      user.id,
      versionId,
      [
        ...extraction.items.map((item) => ({
          category: item.category,
          description: item.description,
          sourceQuote: item.sourceQuote,
          sourceLocator: item.sourceLocator,
          quoteStart: item.quoteStart,
          quoteEnd: item.quoteEnd,
          userAdded: false,
        })),
        ...carried,
      ],
    );

    revalidatePath(`/projects/${projectId}/scope`);
    return {
      ok: true,
      rejected: extraction.rejected.length ? extraction.rejected : undefined,
    };
  } catch (error) {
    revalidatePath(`/projects/${projectId}/scope`);
    return {
      error: `Your document was saved, but scope extraction failed: ${messageFor(error)} You can retry without re-uploading.`,
    };
  }
}

/**
 * Commit a reviewed call transcript as the scope document (plan §10 Tier 1).
 *
 * The cues arrive from the review screen the user just edited, which is the
 * human-review gate: this write is what sets transcript_reviewed_at, and the
 * database CHECK constraint refuses a transcript document without it. The
 * document text and timestamp locators are rebuilt from the CONFIRMED cues —
 * not from the original paste or the machine's raw output — so an edit that
 * shifts offsets cannot leave evidence pointing at the wrong span.
 */
export async function ingestTranscriptAction(
  projectId: string,
  input: {
    title: string;
    cues: TranscriptCue[];
    storagePath?: string | null;
  },
): Promise<ScopeFormState> {
  const user = await requireUser();

  const cues = input.cues
    .map((cue) => ({
      startSec: Number(cue.startSec),
      endSec: Number(cue.endSec),
      text: String(cue.text ?? "").trim(),
    }))
    .filter(
      (cue) =>
        cue.text.length > 0 &&
        Number.isFinite(cue.startSec) &&
        Number.isFinite(cue.endSec) &&
        cue.startSec >= 0,
    )
    .sort((a, b) => a.startSec - b.startSec);

  if (cues.length === 0) {
    return { error: "The transcript is empty. Keep at least one cue with text, or use a different transcript." };
  }

  const durationSec = transcriptDurationSec(cues);
  if (durationSec > TRANSCRIPT_MAX_DURATION_SEC) {
    return {
      error: `That transcript covers more than ${Math.floor(TRANSCRIPT_MAX_DURATION_SEC / 60)} minutes of calls. Split it by agreement, or paste the part that defines the scope.`,
    };
  }

  const { text, locators } = buildTranscriptDocument(cues);

  let versionId: string;

  try {
    const { version } = await createScopeDocument(user.id, projectId, {
      title: input.title.trim() || "Call transcript",
      text,
      sourceKind: "transcript",
      locators,
      storagePath: input.storagePath ?? null,
      transcript: true,
    });
    versionId = version.id;
  } catch (error) {
    return { error: messageFor(error) };
  }

  try {
    const extraction = await extractScope(text, locators, undefined, { transcript: true });

    await replaceScopeItems(
      user.id,
      versionId,
      extraction.items.map((item) => ({
        category: item.category,
        description: item.description,
        sourceQuote: item.sourceQuote,
        sourceLocator: item.sourceLocator,
        quoteStart: item.quoteStart,
        quoteEnd: item.quoteEnd,
        userAdded: false,
        commitment: item.commitment,
      })),
    );

    revalidatePath(`/projects/${projectId}/scope`);

    return {
      ok: true,
      rejected: extraction.rejected.length ? extraction.rejected : undefined,
    };
  } catch (error) {
    // The transcript survived; only extraction failed. The screen offers a
    // retry that does not require re-pasting.
    revalidatePath(`/projects/${projectId}/scope`);
    return {
      error: `Your transcript was saved, but scope extraction failed: ${messageFor(error)} You can retry without re-pasting.`,
    };
  }
}

/**
 * Store the user's rough call notes and structure them (plan §10, Tier 2).
 *
 * There is no agreement to extract from — these notes are the user's own
 * memory — so the extraction proposes items with NO quotes, stored as
 * provenance "memory": visibly unverified on every surface, never evidence.
 * The document is still written before the model call, so a failed run
 * leaves the notes intact with a retry.
 */
export async function ingestNotesAction(
  projectId: string,
  _prev: ScopeFormState,
  formData: FormData,
): Promise<ScopeFormState> {
  const user = await requireUser();

  const title = String(formData.get("title") ?? "").trim() || "Notes from our call";
  const text = String(formData.get("text") ?? "");
  const callDate = String(formData.get("callDate") ?? "").trim();
  const participants = String(formData.get("participants") ?? "").trim();

  if (callDate && !/^\d{4}-\d{2}-\d{2}$/.test(callDate)) {
    return { error: "The call date must be a valid date, or left blank." };
  }
  if (participants.length > 300) {
    return { error: "Keep the participants list under 300 characters." };
  }

  let versionId: string;

  try {
    const { version } = await createScopeDocument(user.id, projectId, {
      title,
      text,
      sourceKind: "recap",
      recap: {
        callDate: callDate || null,
        participants: participants || null,
      },
    });
    versionId = version.id;
  } catch (error) {
    return { error: messageFor(error) };
  }

  try {
    const extraction = await extractScopeFromNotes(text);

    await replaceScopeItems(
      user.id,
      versionId,
      extraction.items.map((item) => ({
        category: item.category,
        description: item.description,
        sourceQuote: null,
        sourceLocator: null,
        quoteStart: null,
        quoteEnd: null,
        // Memory is not evidence: these occupy the same no-quote slot as a
        // user-typed item, marked provenance "memory" so every surface can
        // say where they came from. The DB CHECK enforces the pairing.
        userAdded: true,
        provenance: "memory" as const,
      })),
    );

    await recordEvent(user.id, {
      projectId,
      event: "Call notes captured",
      note: "Rough notes structured as unverified scope items. Send the recap to get them in writing.",
    });

    revalidatePath(`/projects/${projectId}/scope`);

    return { ok: true };
  } catch (error) {
    revalidatePath(`/projects/${projectId}/scope`);
    return {
      error: `Your notes were saved, but structuring failed: ${messageFor(error)} You can retry without re-typing.`,
    };
  }
}

/** Re-run extraction against the already-saved document. */
export async function retryExtractionAction(projectId: string): Promise<ScopeFormState> {
  const user = await requireUser();

  try {
    const state = await getScopeState(user.id, projectId);
    if (!state.draft || !state.document) {
      return { error: "There is no draft baseline to extract." };
    }

    const document = await getScopeDocument(user.id, state.document.id);

    if (document.sourceKind === "recap") {
      // Notes have nothing to verify quotes against — the no-source path.
      const extraction = await extractScopeFromNotes(document.extractedText);

      await replaceScopeItems(
        user.id,
        state.draft.id,
        extraction.items.map((item) => ({
          category: item.category,
          description: item.description,
          sourceQuote: null,
          sourceLocator: null,
          quoteStart: null,
          quoteEnd: null,
          userAdded: true,
          provenance: "memory" as const,
        })),
      );

      revalidatePath(`/projects/${projectId}/scope`);
      return { ok: true };
    }

    const extraction = await extractScope(document.extractedText, document.locators, undefined, {
      transcript: document.transcriptApplied,
    });

    // A retried extraction over a notes baseline still owes the memory items
    // their carry-forward decision.
    const carried = await carryForwardMemoryItems(
      user.id,
      projectId,
      state.draft.id,
      extraction.items,
    );

    await replaceScopeItems(
      user.id,
      state.draft.id,
      [
        ...extraction.items.map((item) => ({
          category: item.category,
          description: item.description,
          sourceQuote: item.sourceQuote,
          sourceLocator: item.sourceLocator,
          quoteStart: item.quoteStart,
          quoteEnd: item.quoteEnd,
          userAdded: false,
          commitment: item.commitment,
        })),
        ...carried,
      ],
    );

    revalidatePath(`/projects/${projectId}/scope`);
    return { ok: true, rejected: extraction.rejected.length ? extraction.rejected : undefined };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/**
 * Persist the user's edited item list.
 *
 * Items the user typed themselves are stored with user_added = true and no
 * source quote, so the UI and every export can keep them visibly distinct
 * from agreed contract text (plan §4).
 */
export async function saveScopeItemsAction(
  projectId: string,
  versionId: string,
  items: Array<{
    category: string;
    description: string;
    sourceQuote: string | null;
    sourceLocator: string | null;
    quoteStart: number | null;
    quoteEnd: number | null;
    userAdded: boolean;
    commitment?: string | null;
    provenance?: string | null;
  }>,
): Promise<FormState> {
  const user = await requireUser();

  const cleaned: ScopeItemInput[] = [];

  for (const item of items) {
    const description = item.description.trim();
    if (description.length === 0) continue;

    if (!SCOPE_CATEGORIES.includes(item.category as ScopeCategory)) {
      return { error: `"${item.category}" is not a valid category.` };
    }

    const hasQuote = Boolean(item.sourceQuote && item.sourceLocator);
    const isMemory = item.provenance === "memory";

    cleaned.push({
      category: item.category as ScopeCategory,
      description,
      sourceQuote: hasQuote ? item.sourceQuote : null,
      sourceLocator: hasQuote ? item.sourceLocator : null,
      quoteStart: hasQuote ? item.quoteStart : null,
      quoteEnd: hasQuote ? item.quoteEnd : null,
      // An item without document evidence is always user-added, whatever the
      // client sent — the database CHECK constraint enforces this too.
      userAdded: item.userAdded || !hasQuote || isMemory,
      commitment:
        !hasQuote || !TRANSCRIPT_COMMITMENTS.includes(item.commitment as TranscriptCommitment)
          ? null
          : (item.commitment as TranscriptCommitment),
      // "memory" only ever marks the user's own recollection; the DB CHECK
      // refuses it on a quoted item.
      provenance: isMemory && !hasQuote ? "memory" : "document",
    });
  }

  try {
    await replaceScopeItems(user.id, versionId, cleaned);
    revalidatePath(`/projects/${projectId}/scope`);
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function confirmScopeAction(
  projectId: string,
  versionId: string,
): Promise<FormState> {
  const user = await requireUser();

  try {
    await confirmScope(user.id, versionId);
    await recordEvent(user.id, {
      projectId,
      event: "Scope confirmed",
      note: "Baseline confirmed and frozen.",
    });

    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

/** Open a new editable version, copying the confirmed baseline forward. */
export async function reviseScopeAction(projectId: string): Promise<FormState> {
  const user = await requireUser();

  try {
    const version = await createDraftVersion(user.id, projectId);
    await recordEvent(user.id, {
      projectId,
      event: "Scope revision started",
      note: `Draft baseline version ${version.version} created. Existing change requests stay linked to the version they were assessed against.`,
    });

    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function isFixtureModeAction(): Promise<boolean> {
  return isFixtureMode();
}
