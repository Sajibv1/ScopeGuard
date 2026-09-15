/**
 * Row mappers: snake_case database rows to camelCase domain objects.
 *
 * Kept in one place so a column rename surfaces as a type error here rather
 * than as an undefined field halfway through a template. Numerics stay as
 * STRINGS all the way through — see lib/money.ts for why.
 */

import type {
  AnalysisRun,
  Assessment,
  ChangeApproval,
  ChangeRequest,
  DocumentVersion,
  EstimateItem,
  Evidence,
  HourSuggestion,
  ItemReview,
  LegalFlag,
  Locator,
  Project,
  ProjectInvite,
  ProjectMember,
  RequestItem,
  ScopeDocument,
  ScopeItem,
  ScopeVersion,
  StatusEvent,
} from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export function toProject(row: Row): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    clientName: row.client_name,
    description: row.description,
    currency: row.currency,
    defaultRate: row.default_rate,
    isSample: row.is_sample,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toScopeDocument(row: Row): ScopeDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    sourceKind: row.source_kind,
    storagePath: row.storage_path,
    extractedText: row.extracted_text,
    locators: (row.locators ?? []) as Locator[],
    ocrApplied: row.ocr_applied ?? false,
    ocrConfidence: row.ocr_confidence ?? null,
    ocrReviewedAt: row.ocr_reviewed_at ?? null,
    transcriptApplied: row.transcript_applied ?? false,
    transcriptReviewedAt: row.transcript_reviewed_at ?? null,
    callDate: row.call_date ?? null,
    participants: row.participants ?? null,
    createdAt: row.created_at,
  };
}

export function toScopeVersion(row: Row): ScopeVersion {
  return {
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    version: row.version,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

export function toScopeItem(row: Row): ScopeItem {
  return {
    id: row.id,
    scopeVersionId: row.scope_version_id,
    category: row.category,
    description: row.description,
    sourceQuote: row.source_quote,
    sourceLocator: row.source_locator,
    quoteStart: row.quote_start,
    quoteEnd: row.quote_end,
    userAdded: row.user_added,
    commitment: row.commitment ?? null,
    provenance: row.provenance === "memory" ? "memory" : "document",
    confirmed: row.confirmed,
    sortOrder: row.sort_order,
  };
}

export function toChangeRequest(row: Row): ChangeRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    scopeVersionId: row.scope_version_id,
    reference: row.reference,
    title: row.title,
    clientMessage: row.client_message,
    receivedOn: row.received_on,
    sourceLabel: row.source_label,
    status: row.status,
    userContext: row.user_context,
    taxLabel: row.tax_label ?? null,
    taxRate: row.tax_rate ?? null,
    sentAt: row.sent_at,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRequestItem(row: Row): RequestItem {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    title: row.title,
    description: row.description,
    sourceExcerpt: row.source_excerpt,
    excerptStart: row.excerpt_start,
    excerptEnd: row.excerpt_end,
    userAdded: row.user_added,
    sortOrder: row.sort_order,
  };
}

export function toAssessment(row: Row): Assessment {
  return {
    id: row.id,
    requestItemId: row.request_item_id,
    analysisRunId: row.analysis_run_id,
    proposedLabel: row.proposed_label,
    explanation: row.explanation,
    supportingEvidence: (row.supporting_evidence ?? []) as Evidence[],
    conflictingEvidence: (row.conflicting_evidence ?? []) as Evidence[],
    missingInformation: row.missing_information ?? [],
    suggestedQuestion: row.suggested_question,
    validationFailed: row.validation_failed,
    validationNotes: row.validation_notes,
    createdAt: row.created_at,
  };
}

export function toItemReview(row: Row): ItemReview {
  return {
    id: row.id,
    requestItemId: row.request_item_id,
    reviewedAssessmentId: row.reviewed_assessment_id,
    finalLabel: row.final_label,
    note: row.note,
    userContextBased: row.user_context_based,
    reviewedAt: row.reviewed_at,
  };
}

export function toAnalysisRun(row: Row): AnalysisRun {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    operation: row.operation,
    status: row.status,
    model: row.model,
    promptVersion: row.prompt_version,
    inputHash: row.input_hash,
    fixtureMode: row.fixture_mode,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function toEstimateItem(row: Row): EstimateItem {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    requestItemId: row.request_item_id,
    description: row.description,
    hours: row.hours,
    rate: row.rate,
    lineTotal: row.line_total ?? "0.00",
    aiSuggested: row.ai_suggested,
    sortOrder: row.sort_order,
  };
}

export function toHourSuggestion(row: Row): HourSuggestion {
  return {
    id: row.id,
    estimateItemId: row.estimate_item_id,
    draftHours: row.draft_hours,
    rationale: row.rationale,
    createdAt: row.created_at,
  };
}

export function toLegalFlag(row: Row): LegalFlag {
  return {
    id: row.id,
    requestItemId: row.request_item_id,
    topic: row.topic,
    note: row.note,
    createdAt: row.created_at,
  };
}

export function toDocumentVersion(row: Row): DocumentVersion {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    kind: row.kind,
    version: row.version,
    tone: row.tone,
    sections: (row.sections ?? {}) as Record<string, string>,
    userEdited: row.user_edited,
    finalizedAt: row.finalized_at,
    snapshot: row.snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toStatusEvent(row: Row): StatusEvent {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    projectId: row.project_id,
    event: row.event,
    actor: row.actor,
    note: row.note,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

export function toProjectMember(row: Row): ProjectMember {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role,
    addedBy: row.added_by ?? null,
    createdAt: row.created_at,
  };
}

export function toProjectInvite(row: Row): ProjectInvite {
  return {
    id: row.id,
    projectId: row.project_id,
    token: row.token,
    role: row.role,
    createdBy: row.created_by,
    acceptedAt: row.accepted_at ?? null,
    createdAt: row.created_at,
  };
}

export function toChangeApproval(row: Row): ChangeApproval {
  return {
    id: row.id,
    changeRequestId: row.change_request_id,
    approverId: row.owner_id,
    role: row.role,
    decision: row.decision,
    note: row.note ?? null,
    createdAt: row.created_at,
  };
}
