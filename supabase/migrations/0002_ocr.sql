-- OCR support for scanned scope documents.
--
-- IMPORTANT PROVENANCE NOTE
--
-- Everywhere else in ScopeGuard, `scope_documents.extracted_text` IS the
-- document: a citation verified against it is verified against the client's
-- actual agreement. OCR breaks that identity. The text becomes a machine
-- TRANSCRIPTION of an image, and a transcription error would let a citation
-- verify cleanly against words the contract never contained.
--
-- So an OCR document is marked as such, permanently and visibly:
--   - ocr_applied        drives the "transcribed, not extracted" labelling
--                        that follows the baseline into every assessment
--                        and every export
--   - ocr_confidence     mean per-page confidence, shown to the user
--   - ocr_reviewed_at    set only when a human confirmed the transcription
--
-- The application refuses to build a baseline from un-reviewed OCR text.

alter table scope_documents
  add column ocr_applied     boolean not null default false,
  add column ocr_confidence  numeric(5, 2)
    check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 100)),
  add column ocr_reviewed_at timestamptz,
  -- Per-page confidence, so a single bad page can be spotted in a good scan:
  -- [{ page: 1, confidence: 94.2, characters: 1840 }]
  add column ocr_pages       jsonb not null default '[]'::jsonb;

-- OCR text may only become a scope document once a human has confirmed it.
alter table scope_documents
  add constraint scope_document_ocr_reviewed
  check (ocr_applied = false or ocr_reviewed_at is not null);

comment on column scope_documents.ocr_applied is
  'Text came from optical character recognition, not from a PDF text layer. Citations against this document are citations against a reviewed transcription.';
