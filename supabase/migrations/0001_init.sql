-- ScopeGuard initial schema
--
-- Design rule from the product plan (§4): AI output, user decisions, and
-- finalized documents are SEPARATE records. Regeneration must never be able
-- to destroy reviewed work. That is why `assessments` (model output) and
-- `item_reviews` (human decision) are distinct tables, and why
-- `document_versions` snapshots are immutable once finalized.

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────

create type scope_category as enum (
  'deliverable',
  'included_functionality',
  'exclusion',
  'quantity_limit',
  'revision_limit',
  'constraint',
  'client_responsibility',
  'milestone'
);

-- The three assessment labels. Note the plan's rule: absence from the
-- document is NOT proof something is out of scope — that is 'needs_clarification',
-- never 'potentially_additional'.
create type assessment_label as enum (
  'included',
  'potentially_additional',
  'needs_clarification'
);

-- Business status. Deliberately separate from processing status so that a
-- failed analysis never shows up as a business state (plan §10).
create type request_status as enum (
  'draft',
  'ready',
  'sent',
  'approved',
  'declined'
);

create type analysis_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'invalid_output'
);

create type ai_operation as enum (
  'extract_scope',
  'analyze_request',
  'draft_documents'
);

create type document_kind as enum ('client_reply', 'change_order');

create type source_kind as enum ('paste', 'pdf');

-- ── Core tables ─────────────────────────────────────────────────────────────

create table projects (
  id       uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name  text not null check (length(btrim(name)) between 1 and 200),
  client_name    text check (length(client_name) <= 200),
  description    text check (length(description) <= 2000),
  currency       text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- Stored as numeric for decimal-safe arithmetic. Never a float.
  default_rate   numeric(12, 2) check (default_rate is null or default_rate >= 0),
  is_sample   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index projects_owner_idx on projects (owner_id, updated_at desc);

-- Raw ingested scope text. Kept forever so evidence can always be re-checked
-- against the ORIGINAL wording (plan §3: "The original text remains available
-- for evidence review").
create table scope_documents (
  id           uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 300),
  source_kind    source_kind not null,
  -- Path inside the PRIVATE storage bucket. Null for pasted text.
  storage_path   text,
  extracted_text text not null check (length(extracted_text) <= 40000),
  -- [{ id: 'p1', kind: 'paragraph'|'page', label: 'Paragraph 1', start: 0, end: 240 }]
  locators       jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);

create index scope_documents_project_idx on scope_documents (project_id, created_at desc);

-- An immutable confirmed baseline. Confirming creates a new version; existing
-- change requests stay pinned to the version they were assessed against.
create table scope_versions (
  id  uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects (id) on delete cascade,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  document_id    uuid not null references scope_documents (id) on delete restrict,
  version integer not null check (version >= 1),
  confirmed_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (project_id, version)
);

create index scope_versions_project_idx on scope_versions (project_id, version desc);

create table scope_items (
  id       uuid primary key default gen_random_uuid(),
  scope_version_id uuid not null references scope_versions (id) on delete cascade,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  category       scope_category not null,
  description    text not null check (length(btrim(description)) between 1 and 2000),
  -- Exact quote from the source document. Null only when user_added is true.
  source_quote   text check (length(source_quote) <= 4000),
  source_locator text,
-- Character offsets into scope_documents.extracted_text, for highlighting.
  quote_start    integer check (quote_start >= 0),
  quote_end integer check (quote_end >= 0),
  -- True when the user typed this in without document evidence. The UI must
  -- label these separately so they never masquerade as agreed contract text.
  user_added     boolean not null default false,
  confirmed      boolean not null default false,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),

  -- An item either cites the document or is explicitly user-added. Never neither.
  constraint scope_item_evidence check (
    user_added = true or (source_quote is not null and source_locator is not null)
  ),
  constraint scope_item_span check (
    quote_start is null or quote_end is null or quote_end > quote_start
  )
);

create index scope_items_version_idx on scope_items (scope_version_id, sort_order);

-- ── Change requests ─────────────────────────────────────────────────────────

create table change_requests (
  id        uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects (id) on delete cascade,
  owner_id         uuid not null references auth.users (id) on delete cascade,
  -- The baseline this request was assessed against. Restrict: a baseline in
  -- use can never be deleted out from under its analysis.
  scope_version_id uuid not null references scope_versions (id) on delete restrict,
  reference        text not null,
  -- Generated once when the capture form is rendered and resubmitted with it.
  -- A double-click therefore collides here instead of creating a second
  -- change request (plan §11: "Repeated submission does not create
  -- duplicate change requests").
  idempotency_key  text,
  title            text not null check (length(btrim(title)) between 1 and 300),
  client_message   text not null check (length(client_message) <= 20000),
  received_on      date,
  source_label  text check (source_label in ('email', 'chat', 'call_notes', 'other')),
  status         request_status not null default 'draft',
  -- Free-text context the user supplies to resolve a clarification, e.g.
  -- "one revision round used so far". Stored as user-provided context, never
  -- promoted to document evidence.
  user_context     text check (length(user_context) <= 4000),
  sent_at          timestamptz,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (project_id, reference)
);

create index change_requests_project_idx on change_requests (project_id, created_at desc);
create unique index change_requests_idempotency_uniq
  on change_requests (owner_id, idempotency_key)
  where idempotency_key is not null;

create table request_items (
  id         uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_requests (id) on delete cascade,
  owner_id          uuid not null references auth.users (id) on delete cascade,
  title             text not null check (length(btrim(title)) between 1 and 300),
  description       text not null default '' check (length(description) <= 4000),
  -- Verbatim excerpt from client_message, so every item traces to the original.
  source_excerpt    text not null check (length(source_excerpt) <= 4000),
  excerpt_start   integer check (excerpt_start >= 0),
  excerpt_end       integer check (excerpt_end >= 0),
  user_added  boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now()
);

create index request_items_request_idx on request_items (change_request_id, sort_order);

-- ── Analysis ────────────────────────────────────────────────────────────────

create table analysis_runs (
  id      uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_requests (id) on delete cascade,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  operation    ai_operation not null,
  status            analysis_status not null default 'queued',
  model             text not null,
  prompt_version    text not null,
  -- Hash of the exact inputs. Lets us detect that a stored result is stale
  -- because the request text or baseline changed (plan §11).
  input_hash text not null,
  fixture_mode      boolean not null default false,
  error_message     text,
  -- Never contains document text — only counts and timings.
  usage             jsonb not null default '{}'::jsonb,
  started_at    timestamptz not null default now(),
  finished_at       timestamptz
);

create index analysis_runs_request_idx on analysis_runs (change_request_id, started_at desc);

-- Model output. Immutable: a re-run creates a NEW row against a new run,
-- it never updates an old one. The human decision lives in item_reviews.
create table assessments (
  id               uuid primary key default gen_random_uuid(),
  request_item_id  uuid not null references request_items (id) on delete cascade,
  analysis_run_id  uuid not null references analysis_runs (id) on delete cascade,
  owner_id         uuid not null references auth.users (id) on delete cascade,
  proposed_label   assessment_label not null,
  explanation      text not null check (length(explanation) <= 4000),
  -- [{ quote, locator, scopeItemId?, start, end, verified: true }]
  -- Every entry has passed citation validation before insert.
  supporting_evidence jsonb not null default '[]'::jsonb,
  conflicting_evidence jsonb not null default '[]'::jsonb,
  missing_information  text[] not null default '{}',
  suggested_question   text check (length(suggested_question) <= 1000),
  -- Set when the model produced output we could not validate. The UI shows
  -- "review required" rather than fabricated evidence.
  validation_failed    boolean not null default false,
  validation_notes     text,
  created_at           timestamptz not null default now()
);

create index assessments_item_idx on assessments (request_item_id, created_at desc);
create unique index assessments_item_run_uniq on assessments (request_item_id, analysis_run_id);

-- The human decision. Separate row, separate timestamp, separate author.
create table item_reviews (
  id   uuid primary key default gen_random_uuid(),
  request_item_id  uuid not null references request_items (id) on delete cascade unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- The assessment the user was looking at when they decided. Lets us detect
  -- "reanalysis happened after this review" instead of silently overwriting.
  reviewed_assessment_id uuid references assessments (id) on delete set null,
  final_label      assessment_label not null,
  note text check (length(note) <= 4000),
  -- True when the user's decision rests on context not in the document
  -- (e.g. a phone agreement). Exports label this as user-provided context.
  user_context_based boolean not null default false,
  reviewed_at      timestamptz not null default now()
);

-- ── Estimates ───────────────────────────────────────────────────────────────

create table estimate_items (
  id      uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_requests (id) on delete cascade,
  request_item_id   uuid references request_items (id) on delete set null,
  owner_id          uuid not null references auth.users (id) on delete cascade,
  description text not null check (length(btrim(description)) between 1 and 1000),
  -- Numeric, not float. Hours stay NULL until a human enters them — the model
  -- may suggest work components but never hours (plan §8).
  hours           numeric(8, 2) check (hours is null or (hours >= 0 and hours <= 10000)),
  rate    numeric(12, 2) check (rate is null or rate >= 0),
  -- Generated by the database so the stored total can never disagree with the
  -- formula. Application code and exports both read this column.
  line_total        numeric(14, 2)
              generated always as (round(coalesce(hours, 0) * coalesce(rate, 0), 2)) stored,
ai_suggested      boolean not null default false,
  sort_order  integer not null default 0,
  created_at   timestamptz not null default now()
);

create index estimate_items_request_idx on estimate_items (change_request_id, sort_order);

-- ── Documents ───────────────────────────────────────────────────────────────

create table document_versions (
  id              uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_requests (id) on delete cascade,
  owner_id          uuid not null references auth.users (id) on delete cascade,
  kind     document_kind not null,
  version         integer not null check (version >= 1),
  tone    text check (tone in ('friendly', 'formal')),
  -- Narrative sections drafted by the model, keyed by section name.
  -- Totals, dates, IDs and estimate tables are NOT here: they are rendered
  -- deterministically from stored data at display/export time (plan §9).
  sections          jsonb not null default '{}'::jsonb,
  -- Set true when the user hand-edited any section. Regeneration must warn.
  user_edited       boolean not null default false,
  -- A finalized/sent version is a frozen snapshot: editing a draft afterwards
  -- must never mutate it. Enforced by trigger below.
  finalized_at      timestamptz,
  -- Fully rendered document (narrative + deterministic facts) captured at
  -- finalization, so a sent document can always be reproduced exactly.
  snapshot          jsonb,
  created_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (change_request_id, kind, version)
);

create index document_versions_request_idx on document_versions (change_request_id, kind, version desc);

create table status_events (
  id    uuid primary key default gen_random_uuid(),
  change_request_id uuid references change_requests (id) on delete cascade,
  project_id        uuid not null references projects (id) on delete cascade,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  event             text not null,
  -- 'user' or 'system'. Approvals are always recorded BY THE USER — the UI
  -- must never imply a verified electronic signature (plan §10).
  actor text not null default 'user' check (actor in ('user', 'system')),
  note       text check (length(note) <= 2000),
  metadata          jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index status_events_request_idx on status_events (change_request_id, created_at desc);
create index status_events_project_idx on status_events (project_id, created_at desc);

-- ── Immutability guards ─────────────────────────────────────────────────────

-- A confirmed baseline is immutable. New scope means a NEW version.
create or replace function guard_confirmed_scope_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.confirmed_at is not null then
    raise exception 'scope version % is confirmed and immutable; create a new version', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger scope_versions_immutable
  before update on scope_versions
  for each row execute function guard_confirmed_scope_version();

-- Items belonging to a confirmed baseline cannot change either.
create or replace function guard_confirmed_scope_items()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_confirmed timestamptz;
  v_version   uuid;
begin
  v_version := coalesce(new.scope_version_id, old.scope_version_id);
  select confirmed_at into v_confirmed from scope_versions where id = v_version;

  if v_confirmed is not null then
    raise exception 'scope version % is confirmed; its items are immutable', v_version
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger scope_items_immutable
  before insert or update or delete on scope_items
  for each row execute function guard_confirmed_scope_items();

-- A finalized document version is a frozen snapshot.
create or replace function guard_finalized_document()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.finalized_at is not null then
    raise exception 'document version % is finalized; create a new version to make changes', old.id
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger document_versions_immutable
  before update on document_versions
  for each row execute function guard_finalized_document();

-- Model output is append-only.
create or replace function guard_assessment_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'assessments are immutable model output; record human decisions in item_reviews'
    using errcode = 'check_violation';
end;
$$;

create trigger assessments_immutable
  before update on assessments
  for each row execute function guard_assessment_immutable();

-- ── updated_at bookkeeping ──────────────────────────────────────────────────

create or replace function touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_touch before update on projects
  for each row execute function touch_updated_at();
create trigger change_requests_touch before update on change_requests
  for each row execute function touch_updated_at();

-- ── Row level security ──────────────────────────────────────────────────────
-- Every table carries owner_id and every policy checks it against auth.uid().
-- Cross-account access must fail at the database, not just in the query layer.

alter table projects   enable row level security;
alter table scope_documents    enable row level security;
alter table scope_versions     enable row level security;
alter table scope_items enable row level security;
alter table change_requests    enable row level security;
alter table request_items      enable row level security;
alter table analysis_runs      enable row level security;
alter table assessments      enable row level security;
alter table item_reviews       enable row level security;
alter table estimate_items     enable row level security;
alter table document_versions  enable row level security;
alter table status_events      enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'scope_documents', 'scope_versions', 'scope_items',
    'change_requests', 'request_items', 'analysis_runs', 'assessments',
    'item_reviews', 'estimate_items', 'document_versions', 'status_events'
  ]
  loop
    execute format(
      'create policy %I on %I for select using (owner_id = (select auth.uid()))',
    t || '_select_own', t
    );
    execute format(
      'create policy %I on %I for insert with check (owner_id = (select auth.uid()))',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on %I for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      t || '_update_own', t
    );
    execute format(
      'create policy %I on %I for delete using (owner_id = (select auth.uid()))',
   t || '_delete_own', t
    );
  end loop;
end;
$$;

-- ── Private storage for uploaded scope documents (P1) ───────────────────────
-- Not a public bucket. Access is per-user, keyed by a <uid>/ path prefix.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scope-documents', 'scope-documents', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "scope docs are readable by owner"
  on storage.objects for select
  using (bucket_id = 'scope-documents' and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "scope docs are writable by owner"
  on storage.objects for insert
  with check (bucket_id = 'scope-documents' and (select auth.uid())::text = (storage.foldername(name))[1]);

create policy "scope docs are deletable by owner"
  on storage.objects for delete
  using (bucket_id = 'scope-documents' and (select auth.uid())::text = (storage.foldername(name))[1]);
