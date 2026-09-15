-- Transcript scope documents (plan §10, Tier 1), part 2: the review gate.
--
-- Mirroring 0002_ocr.sql:
--   - transcript_applied      drives the "transcript, not a contract"
--                             labelling on every evidence surface
--   - transcript_reviewed_at  set only when a human reviewed the transcript
--                             on screen before it was committed
--
-- The review gate is the whole point: whether the transcript came from Zoom,
-- Whisper, or anything else, the stored text is a transcription of speech,
-- and a recognition error must not silently become scope. The write that
-- creates a transcript document is the same write that records the review —
-- the caller may only pass the flag after the user confirmed on screen.
--
-- scope_items.commitment records how firmly the client committed in the call
-- ("agreed" / "discussed" / "suggested"). It is extraction DRAFT output the
-- user reviews, not a determination: only the user's confirmation makes any
-- item part of the baseline, whatever its label.

alter table scope_documents
  add column transcript_applied     boolean not null default false,
  add column transcript_reviewed_at timestamptz;

-- A transcript document is always flagged, and the flag only exists on
-- transcript documents: source_kind and the applied/reviewed pair cannot
-- disagree.
alter table scope_documents
  add constraint scope_document_transcript_reviewed
    check (transcript_applied = false or transcript_reviewed_at is not null),
  add constraint scope_document_transcript_kind
    check ((source_kind = 'transcript') = transcript_applied);

comment on column scope_documents.transcript_applied is
  'True when extracted_text is a transcript of a spoken conversation (pasted Zoom/Meet transcript or machine transcription of audio). Evidence from this document must be labelled as a reviewed transcript, never as contract text.';
comment on column scope_documents.transcript_reviewed_at is
  'When a human reviewed the transcript on screen before it became a scope document. Required whenever transcript_applied is true.';

alter table scope_items
  add column commitment text
    check (commitment in ('agreed', 'discussed', 'suggested'));

comment on column scope_items.commitment is
  'For transcript-derived items: how firmly the client committed in the call. Null for every other source, and for items the user added without document evidence.';
