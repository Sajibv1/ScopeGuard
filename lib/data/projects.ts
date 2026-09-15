/**
 * Project and scope queries.
 *
 * Two rules hold throughout this file:
 *
 *  1. Read queries rely on RLS for visibility (owner OR project member —
 *     migration 0005) and keep their owner filters on write paths. Working
 *     rows always carry the project owner's id, which migration 0006 makes a
 *     database invariant on INSERT, so member sessions can read but never
 *     land a row.
 *  2. Confirmed baselines are never mutated. `confirmScope` freezes a version;
 *     any later change goes through `createDraftVersion`, which copies the
 *     items forward into a new version. Existing change requests keep pointing
 *     at the version they were assessed against (plan §4).
 */

import "server-only";

import { NotFoundError } from "@/lib/auth";
import { buildParagraphLocators } from "@/lib/ai/citations";
import { createClient } from "@/lib/supabase/server";
import type { Locator, OcrPageRecord, Project, ScopeCategory, ScopeDocument, ScopeItem, ScopeVersion, TranscriptCommitment } from "@/lib/types";

import { SCOPE_TEXT_LIMIT } from "@/lib/limits";

import {
  toProject,
  toScopeDocument,
  toScopeItem,
  toScopeVersion,
} from "./mappers";



// ── Projects ────────────────────────────────────────────────────────────────

export interface ProjectSummary extends Project {
  hasConfirmedScope: boolean;
  openRequestCount: number;
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const supabase = await createClient();

  // Owned projects plus projects this user is a member of — teammates see
  // their shared projects on the dashboard too, not just via invite links.
  //
  // No owner/member filter is needed here: the projects SELECT policy
  // (migration 0005) is `owner_id = auth.uid() or is_project_member(id)`,
  // so RLS returns exactly the visible rows. An .or() filter cannot express
  // this anyway — PostgREST's logic tree cannot traverse embedded tables,
  // which is what the PGRST100 this fixed looked like.
  const { data, error } = await supabase
    .from("projects")
    .select(
      `*,
       project_members(user_id),
       scope_versions(id, confirmed_at),
       change_requests(id, status)`,
    )
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    ...toProject(row),
    hasConfirmedScope: (row.scope_versions ?? []).some(
      (version: { confirmed_at: string | null }) => version.confirmed_at !== null,
    ),
    openRequestCount: (row.change_requests ?? []).filter((request: { status: string }) =>
      ["draft", "ready", "sent"].includes(request.status),
    ).length,
  }));
}

export async function getProject(userId: string, projectId: string): Promise<Project> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("project");

  return toProject(data);
}

export interface CreateProjectInput {
  name: string;
  clientName: string | null;
  description: string | null;
  currency: string;
  defaultRate: string | null;
  isSample?: boolean;
}

export async function createProject(
  userId: string,
  input: CreateProjectInput,
): Promise<Project> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("projects")
    .insert({
      owner_id: userId,
      name: input.name,
      client_name: input.clientName,
      description: input.description,
      currency: input.currency,
      default_rate: input.defaultRate,
      is_sample: input.isSample ?? false,
    })
    .select()
    .single();

  if (error) throw error;
  return toProject(data);
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: Partial<CreateProjectInput>,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("projects")
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.clientName !== undefined && { client_name: input.clientName }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.defaultRate !== undefined && { default_rate: input.defaultRate }),
    })
    .eq("id", projectId)
    .eq("owner_id", userId);

  if (error) throw error;
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("owner_id", userId);

  if (error) throw error;
}

// ── Scope documents and versions ────────────────────────────────────────────

export async function getScopeDocument(
  userId: string,
  documentId: string,
): Promise<ScopeDocument> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scope_documents")
    .select("*")
    .eq("id", documentId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("scope document");

  return toScopeDocument(data);
}

/**
 * Store pasted scope text and open a draft version against it.
 *
 * The original text is stored verbatim and never truncated — the plan is
 * explicit that the application must not silently shorten the agreement, so
 * over-length input is rejected at the boundary with a message instead.
 */
export async function createScopeDocument(
  userId: string,
  projectId: string,
  input: {
    title: string;
    text: string;
    sourceKind?: "paste" | "pdf" | "transcript" | "recap";
    locators?: Locator[];
    storagePath?: string | null;
    /**
     * Present only for recap documents (plan §10 Tier 2): the user's own
     * rough notes about a call. Unlike transcripts and OCR there is no
     * machine output to review — the notes are the user's own words — so
     * there is no review-gate flag; the call metadata exists so the recap
     * PDF can tell the client which conversation they are confirming.
     */
    recap?: { callDate?: string | null; participants?: string | null };
    /**
     * Present only for transcript documents. As with OCR, the write itself is
     * the human-review gate: the caller may only pass this AFTER the user has
     * reviewed the transcript on screen, because the database CHECK constraint
     * (0010) refuses transcript_applied without transcript_reviewed_at.
     */
    transcript?: boolean;
    /**
     * Present only for OCR documents. The write itself is the human-review
     * gate: the caller may only pass this AFTER the user has reviewed and
     * confirmed the transcription on screen, because the database CHECK
     * constraint (0002_ocr.sql) refuses ocr_applied without ocr_reviewed_at.
     */
    ocr?: { confidence: number; pages: OcrPageRecord[] };
  },
): Promise<{ document: ScopeDocument; version: ScopeVersion }> {
  if (input.text.trim().length === 0) {
    throw new Error("The scope document is empty. Paste the agreement text to continue.");
  }

  if (input.text.length > SCOPE_TEXT_LIMIT) {
    throw new Error(
      `This document is ${input.text.length.toLocaleString()} characters, over the ${SCOPE_TEXT_LIMIT.toLocaleString()} character limit. Paste the section that defines the scope rather than the whole contract.`,
    );
  }

  const supabase = await createClient();
  const locators = input.locators ?? buildParagraphLocators(input.text);

  const { data: documentRow, error: documentError } = await supabase
    .from("scope_documents")
    .insert({
      project_id: projectId,
      owner_id: userId,
      title: input.title,
      source_kind: input.sourceKind ?? "paste",
      storage_path: input.storagePath ?? null,
      extracted_text: input.text,
      locators,
      ...(input.recap
        ? {
            call_date: input.recap.callDate || null,
            participants: input.recap.participants?.trim() || null,
          }
        : {}),
      ...(input.transcript
        ? {
            transcript_applied: true,
            // Set in the same write as transcript_applied — the constraint
            // allows nothing else, and the review genuinely happened before
            // the confirm.
            transcript_reviewed_at: new Date().toISOString(),
          }
        : {}),
      ...(input.ocr
        ? {
            ocr_applied: true,
            ocr_confidence: input.ocr.confidence,
            // Set in the same write as ocr_applied — the constraint allows
            // nothing else, and the review genuinely happened before confirm.
            ocr_reviewed_at: new Date().toISOString(),
            ocr_pages: input.ocr.pages,
          }
        : {}),
    })
    .select()
    .single();

  if (documentError) throw documentError;

  const version = await createVersionRow(userId, projectId, documentRow.id);
  return { document: toScopeDocument(documentRow), version };
}

async function createVersionRow(
  userId: string,
  projectId: string,
  documentId: string,
): Promise<ScopeVersion> {
  const supabase = await createClient();

  const { data: existing, error: countError } = await supabase
    .from("scope_versions")
    .select("version")
    .eq("project_id", projectId)
    .eq("owner_id", userId)
    .order("version", { ascending: false })
    .limit(1);

  if (countError) throw countError;

  const nextVersion = (existing?.[0]?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from("scope_versions")
    .insert({
      project_id: projectId,
      owner_id: userId,
      document_id: documentId,
      version: nextVersion,
    })
    .select()
    .single();

  if (error) throw error;
  return toScopeVersion(data);
}

export async function getDraftVersion(
  userId: string,
  projectId: string,
): Promise<ScopeVersion | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scope_versions")
    .select("*")
    .eq("project_id", projectId)
    .is("confirmed_at", null)
    .order("version", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] ? toScopeVersion(data[0]) : null;
}

export async function getConfirmedVersion(
  userId: string,
  projectId: string,
): Promise<ScopeVersion | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scope_versions")
    .select("*")
    .eq("project_id", projectId)
    .not("confirmed_at", "is", null)
    .order("version", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] ? toScopeVersion(data[0]) : null;
}

export async function getScopeVersion(
  userId: string,
  versionId: string,
): Promise<ScopeVersion> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scope_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("scope version");

  return toScopeVersion(data);
}

export async function listScopeItems(
  userId: string,
  versionId: string,
): Promise<ScopeItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scope_items")
    .select("*")
    .eq("scope_version_id", versionId)
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map(toScopeItem);
}

export interface ScopeItemInput {
  category: ScopeCategory;
  description: string;
  sourceQuote: string | null;
  sourceLocator: string | null;
  quoteStart: number | null;
  quoteEnd: number | null;
  userAdded: boolean;
  /** Transcript items only: how firmly the client committed in the call. */
  commitment?: TranscriptCommitment | null;
  /**
   * "memory" marks an item proposed from the user's rough notes: no quote,
   * never evidence (the DB CHECK forces user_added alongside it).
   */
  provenance?: "document" | "memory";
}

export async function replaceScopeItems(
  userId: string,
  versionId: string,
  items: ScopeItemInput[],
): Promise<void> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("scope_items")
    .delete()
    .eq("scope_version_id", versionId)
    .eq("owner_id", userId);

  if (deleteError) throw deleteError;
  if (items.length === 0) return;

  const { error } = await supabase.from("scope_items").insert(
    items.map((item, index) => ({
      scope_version_id: versionId,
      owner_id: userId,
      category: item.category,
      description: item.description,
      source_quote: item.sourceQuote,
      source_locator: item.sourceLocator,
      quote_start: item.quoteStart,
      quote_end: item.quoteEnd,
      user_added: item.userAdded,
      // Only transcript items carry a commitment, and never user-added ones —
      // a label about what the CLIENT said cannot attach to the user's own note.
      commitment: item.userAdded ? null : (item.commitment ?? null),
      provenance: item.provenance ?? "document",
      sort_order: index,
      confirmed: false,
    })),
  );

  if (error) throw error;
}

/**
 * Freeze a baseline. After this the version and its items are immutable —
 * enforced by database triggers, not just by this function.
 */
export async function confirmScope(userId: string, versionId: string): Promise<void> {
  const supabase = await createClient();

  const items = await listScopeItems(userId, versionId);
  if (items.length === 0) {
    throw new Error("Add at least one scope item before confirming the baseline.");
  }

  const { error: itemError } = await supabase
    .from("scope_items")
    .update({ confirmed: true })
    .eq("scope_version_id", versionId)
    .eq("owner_id", userId);

  if (itemError) throw itemError;

  const { error } = await supabase
    .from("scope_versions")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", versionId)
    .eq("owner_id", userId);

  if (error) throw error;
}

/**
 * Start a new draft baseline from the confirmed one.
 *
 * Copies the existing items forward so the user edits a copy. The confirmed
 * version keeps its rows untouched, which is what lets an old change request
 * still show the evidence it was actually assessed against.
 */
export async function createDraftVersion(
  userId: string,
  projectId: string,
): Promise<ScopeVersion> {
  const confirmed = await getConfirmedVersion(userId, projectId);
  if (!confirmed) throw new NotFoundError("confirmed baseline");

  const existingDraft = await getDraftVersion(userId, projectId);
  if (existingDraft) return existingDraft;

  const version = await createVersionRow(userId, projectId, confirmed.documentId);
  const items = await listScopeItems(userId, confirmed.id);

  await replaceScopeItems(
    userId,
    version.id,
    items.map((item) => ({
      category: item.category,
      description: item.description,
      sourceQuote: item.sourceQuote,
      sourceLocator: item.sourceLocator,
      quoteStart: item.quoteStart,
      quoteEnd: item.quoteEnd,
      userAdded: item.userAdded,
      // Carried forward intact: a revision must not silently drop the
      // commitment labels from a transcript baseline or the memory marking
      // from a recap baseline.
      commitment: item.commitment,
      provenance: item.provenance,
    })),
  );

  return version;
}

/**
 * Memory items (plan §10 Tier 2) from the most recent version OTHER than the
 * one being written, if any. When the user ingests a real document after a
 * notes baseline — the client's confirmed reply, or an SOW that finally
 * arrived — these are the items that must carry forward or resolve, so the
 * notes are never silently discarded and never silently trusted.
 */
export async function latestMemoryItems(
  userId: string,
  projectId: string,
  excludeVersionId: string,
): Promise<ScopeItem[]> {
  const supabase = await createClient();

  const { data: versions, error } = await supabase
    .from("scope_versions")
    .select("id")
    .eq("project_id", projectId)
    .eq("owner_id", userId)
    .neq("id", excludeVersionId)
    .order("version", { ascending: false })
    .limit(5);

  if (error) throw error;

  for (const version of versions ?? []) {
    const items = await listScopeItems(userId, version.id);
    const memory = items.filter((item) => item.provenance === "memory");
    if (memory.length > 0) return memory;
  }

  return [];
}

export interface ScopeState {
  document: ScopeDocument | null;
  draft: ScopeVersion | null;
  confirmed: ScopeVersion | null;
  items: ScopeItem[];
}

/** Everything the scope screen needs, in one round of queries. */
export async function getScopeState(
  userId: string,
  projectId: string,
): Promise<ScopeState> {
  const [draft, confirmed] = await Promise.all([
    getDraftVersion(userId, projectId),
    getConfirmedVersion(userId, projectId),
  ]);

  const active = draft ?? confirmed;
  if (!active) return { document: null, draft: null, confirmed: null, items: [] };

  const [document, items] = await Promise.all([
    getScopeDocument(userId, active.documentId),
    listScopeItems(userId, active.id),
  ]);

  return { document, draft, confirmed, items };
}
