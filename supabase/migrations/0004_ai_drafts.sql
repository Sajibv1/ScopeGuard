-- AI draft suggestions (§8 refusals, honest versions).
--
-- Two tables, one rule: AI output that resembles a decision or a number is
-- stored SEPARATELY from the records those things are supposed to come from,
-- and the UI labels it as a draft for the human to type over.
--
--  ai_hour_suggestions  — the model's rough reference figure for an estimate
--                         line. estimate_items.hours stays NULL until the
--                         human types their own figure; computeTotals never
--                         reads this table. One row per estimate line,
--                         replaced on re-run.
--  ai_legal_flags       — contract-adjacent TOPICS worth professional review
--                         (indemnification, IP ownership, warranties…).
--                         Notes are validated to contain no legal conclusion
--                         (no breach/liability/enforceability claims), and
--                         they never reach an export — internal only.

create table ai_hour_suggestions (
  id               uuid primary key default gen_random_uuid(),
  estimate_item_id uuid not null references estimate_items (id) on delete cascade unique,
  owner_id         uuid not null references auth.users (id) on delete cascade,
  draft_hours      numeric(8, 2) not null check (draft_hours >= 0 and draft_hours <= 10000),
  rationale        text not null check (length(btrim(rationale)) between 1 and 1000),
  created_at       timestamptz not null default now()
);

create index ai_hour_suggestions_owner_idx on ai_hour_suggestions (owner_id);

create table ai_legal_flags (
  id               uuid primary key default gen_random_uuid(),
  request_item_id  uuid not null references request_items (id) on delete cascade,
  owner_id         uuid not null references auth.users (id) on delete cascade,
  topic            text not null check (length(btrim(topic)) between 1 and 80),
  note             text not null check (length(btrim(note)) between 1 and 1000),
  created_at       timestamptz not null default now(),
  -- One flag per topic per item: a re-run refreshes the note rather than
  -- accumulating duplicates.
  unique (request_item_id, topic)
);

create index ai_legal_flags_owner_idx on ai_legal_flags (owner_id);

alter table ai_hour_suggestions enable row level security;
alter table ai_legal_flags   enable row level security;

create policy ai_hour_suggestions_select_own on ai_hour_suggestions
  for select using (owner_id = (select auth.uid()));
create policy ai_hour_suggestions_insert_own on ai_hour_suggestions
  for insert with check (owner_id = (select auth.uid()));
create policy ai_hour_suggestions_update_own on ai_hour_suggestions
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy ai_hour_suggestions_delete_own on ai_hour_suggestions
  for delete using (owner_id = (select auth.uid()));

create policy ai_legal_flags_select_own on ai_legal_flags
  for select using (owner_id = (select auth.uid()));
create policy ai_legal_flags_insert_own on ai_legal_flags
  for insert with check (owner_id = (select auth.uid()));
create policy ai_legal_flags_update_own on ai_legal_flags
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy ai_legal_flags_delete_own on ai_legal_flags
  for delete using (owner_id = (select auth.uid()));
