-- Recap-then-confirm (plan §10, Tier 2), part 2: memory provenance and the
-- recap's call metadata.
--
-- The boundary: when there is no recording and no document, ScopeGuard must
-- not present memory as evidence. Notes become a scope document (source_kind
-- 'recap') whose items are proposed as provenance 'memory' with NO source
-- quote — the same "no evidence" slot as a user-typed item, but labeled so
-- every surface can say where they came from. The confirmed client reply —
-- pasted or uploaded as a normal document later — is what becomes the
-- verifiable baseline; memory items it does not confirm are carried forward,
-- still unverified, and flagged for review.

alter table scope_documents
  add column call_date   date,
  add column participants text check (length(btrim(participants)) <= 300);

-- Call metadata only exists on recap documents.
alter table scope_documents
  add constraint scope_document_recap_meta
    check ((source_kind = 'recap') or (call_date is null and participants is null));

comment on column scope_documents.call_date is
  'When the call the notes describe took place. Only meaningful for source_kind = recap; the recap PDF states it so the client knows which conversation they are confirming.';
comment on column scope_documents.participants is
  'Who was on the call the notes describe. Only meaningful for source_kind = recap.';

alter table scope_items
  add column provenance text not null default 'document'
    check (provenance in ('document', 'memory'));

-- Memory items are never quoted evidence. The evidence CHECK from 0001
-- already forces user_added when there is no quote; this makes the converse
-- explicit too, so 'memory' can only ever mark the user's own recollection.
alter table scope_items
  add constraint scope_item_memory_not_evidence
    check (provenance <> 'memory' or user_added = true);

comment on column scope_items.provenance is
  'document = backed by a source quote. memory = proposed from the user''s rough notes (recap flow): visibly unverified, never evidence, and flagged for review once a client reply exists.';
