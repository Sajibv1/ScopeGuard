-- Team roles and internal approval chains (§8 deferred item, built on request).
--
-- The design keeps two product guarantees intact:
--
--  1. Writes stay owner-only. Every existing INSERT/UPDATE/DELETE policy is
--     untouched; members gain SELECT on project data so they can REVIEW, and
--     the only new write path is change_approvals, where the row's owner IS
--     the approver recording their own decision.
--  2. Approvals are records of human acts, never signatures (plan §10). An
--     internal approval says "a second person checked this before it went
--     out" — the UI and exports phrase it exactly that way.
--
-- The chain is a separation-of-duties gate on READY -> SENT: when a project
-- has teammates who can approve, the owner cannot mark a change order sent
-- until one of them has signed off. A solo project (no such teammates) keeps
-- the single-user flow — the gate degrades to nothing, which is why the demo
-- story survives unchanged.

-- ── Roles ────────────────────────────────────────────────────────────────────

create type member_role as enum ('admin', 'approver', 'viewer');

-- ── Membership and invites ───────────────────────────────────────────────────

create table project_members (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  -- The member. Distinct from owner_id: rows the OWNER writes carry the
  -- owner's id, this column is who the membership is FOR.
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       member_role not null default 'viewer',
  added_by   uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index project_members_project_idx on project_members (project_id);
create index project_members_user_idx on project_members (user_id);

-- Invite links. The token IS the delivery mechanism (no email is sent — the
-- product never contacts anyone on its own), so it is an unguessable uuid
-- and single-use. Admins can revoke by deleting the row.
create table project_invites (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  token       uuid not null default gen_random_uuid() unique,
  role        member_role not null default 'viewer',
  created_by  uuid not null references auth.users (id) on delete cascade,
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create index project_invites_project_idx on project_invites (project_id);

-- ── Internal approvals ───────────────────────────────────────────────────────

-- One row per person who signed off on a change request. The approver is a
-- DIFFERENT person from the preparer by construction: the owner cannot be a
-- project_member of their own project (the accept function refuses, and the
-- UI never offers it), so every approval row here is a second pair of eyes.
create table change_approvals (
  id                uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_requests (id) on delete cascade,
  -- The approver. Owns the row; nobody else can write it.
  owner_id          uuid not null references auth.users (id) on delete cascade,
  -- Role at the time of approval, so the record says what authority it was
  -- made with even if the role changes later.
  role              member_role not null,
  decision          text not null check (decision in ('approved', 'changes_requested')),
  note              text check (length(btrim(note)) <= 2000),
  created_at        timestamptz not null default now(),
  unique (change_request_id, owner_id)
);

create index change_approvals_request_idx on change_approvals (change_request_id, created_at desc);

-- ── Membership helpers (policy support) ──────────────────────────────────────
--
-- Security definer so policies on OTHER tables can read membership without
-- recursive RLS. search_path pinned; execute revoked from client roles below
-- so they cannot be called as an oracle — they exist for policies only.

create function is_project_member(p_project uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = p_project and p.owner_id = (select auth.uid())
  ) or exists (
    select 1 from project_members m
    where m.project_id = p_project and m.user_id = (select auth.uid())
  );
$$;

-- True when the current user is the project owner OR a member with one of
-- the given roles. The owner is always admin-equivalent.
create function has_project_role(p_project uuid, p_roles member_role[])
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = p_project and p.owner_id = (select auth.uid())
  ) or exists (
    select 1 from project_members m
    where m.project_id = p_project
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

-- Project resolvers for tables that have no direct project_id column.
create function change_request_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select cr.project_id from change_requests cr where cr.id = p_id;
$$;

create function request_item_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select cr.project_id
  from request_items ri
  join change_requests cr on cr.id = ri.change_request_id
  where ri.id = p_id;
$$;

create function analysis_run_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select cr.project_id
  from analysis_runs ar
  join change_requests cr on cr.id = ar.change_request_id
  where ar.id = p_id;
$$;

create function assessment_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select cr.project_id
  from assessments a
  join request_items ri on ri.id = a.request_item_id
  join change_requests cr on cr.id = ri.change_request_id
  where a.id = p_id;
$$;

create function item_review_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select cr.project_id
  from item_reviews r
  join request_items ri on ri.id = r.request_item_id
  join change_requests cr on cr.id = ri.change_request_id
  where r.id = p_id;
$$;

create function estimate_item_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select cr.project_id
  from estimate_items ei
  join change_requests cr on cr.id = ei.change_request_id
  where ei.id = p_id;
$$;

create function document_version_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select cr.project_id
  from document_versions dv
  join change_requests cr on cr.id = dv.change_request_id
  where dv.id = p_id;
$$;

create function change_approval_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select cr.project_id
  from change_approvals ca
  join change_requests cr on cr.id = ca.change_request_id
  where ca.id = p_id;
$$;

create function scope_item_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select sv.project_id
  from scope_items si
  join scope_versions sv on sv.id = si.scope_version_id
  where si.id = p_id;
$$;

-- ── RLS: new tables ──────────────────────────────────────────────────────────

alter table project_members  enable row level security;
alter table project_invites  enable row level security;
alter table change_approvals enable row level security;

-- The roster is visible to everyone the roster is about. Joining happens via
-- accept_project_invite (security definer), so INSERT here is admin-only.
create policy project_members_select_project on project_members
  for select using (user_id = (select auth.uid()) or is_project_member(project_id));
create policy project_members_insert_admin on project_members
  for insert with check (has_project_role(project_id, array['admin']::member_role[]));
create policy project_members_update_admin on project_members
  for update using (has_project_role(project_id, array['admin']::member_role[]))
  with check (has_project_role(project_id, array['admin']::member_role[]));
-- A member may remove themselves; admins may remove anyone.
create policy project_members_delete_own on project_members
  for delete using (
    user_id = (select auth.uid())
    or has_project_role(project_id, array['admin']::member_role[])
  );

-- Only admins (and the owner) ever see or manage invites.
create policy project_invites_select_admin on project_invites
  for select using (has_project_role(project_id, array['admin']::member_role[]));
create policy project_invites_insert_admin on project_invites
  for insert with check (has_project_role(project_id, array['admin']::member_role[]));
create policy project_invites_delete_admin on project_invites
  for delete using (has_project_role(project_id, array['admin']::member_role[]));

-- Approvals are readable by anyone who can see the project, and writable
-- only by the approver themselves — and only within a project they belong to.
create policy change_approvals_select_project on change_approvals
  for select using (is_project_member(change_approval_project(id)));
create policy change_approvals_insert_own on change_approvals
  for insert with check (
    owner_id = (select auth.uid())
    and is_project_member(change_request_project(change_request_id))
  );
-- No update or delete policy: an approval is an immutable record. Revision
-- resets them wholesale via the trigger below (as the definer, not as the
-- updater, so it works no matter who returned the request to draft).

-- ── RLS: members gain read access to project data ────────────────────────────
--
-- SELECT policies are replaced (same names) to allow project members. All
-- INSERT/UPDATE/DELETE policies keep their owner_id checks, so members stay
-- structurally read-only — an accidental write from a member session fails
-- at the database, not just in the UI.

drop policy projects_select_own on projects;
create policy projects_select_own on projects
  for select using (owner_id = (select auth.uid()) or is_project_member(id));

drop policy scope_documents_select_own on scope_documents;
create policy scope_documents_select_own on scope_documents
  for select using (
    owner_id = (select auth.uid()) or is_project_member(project_id)
  );

drop policy scope_versions_select_own on scope_versions;
create policy scope_versions_select_own on scope_versions
  for select using (
    owner_id = (select auth.uid()) or is_project_member(project_id)
  );

drop policy scope_items_select_own on scope_items;
create policy scope_items_select_own on scope_items
  for select using (
    owner_id = (select auth.uid()) or is_project_member(scope_item_project(id))
  );

drop policy change_requests_select_own on change_requests;
create policy change_requests_select_own on change_requests
  for select using (
    owner_id = (select auth.uid()) or is_project_member(project_id)
  );

drop policy request_items_select_own on request_items;
create policy request_items_select_own on request_items
  for select using (
    owner_id = (select auth.uid()) or is_project_member(request_item_project(id))
  );

drop policy analysis_runs_select_own on analysis_runs;
create policy analysis_runs_select_own on analysis_runs
  for select using (
    owner_id = (select auth.uid()) or is_project_member(analysis_run_project(id))
  );

drop policy assessments_select_own on assessments;
create policy assessments_select_own on assessments
  for select using (
    owner_id = (select auth.uid()) or is_project_member(assessment_project(id))
  );

drop policy item_reviews_select_own on item_reviews;
create policy item_reviews_select_own on item_reviews
  for select using (
    owner_id = (select auth.uid()) or is_project_member(item_review_project(id))
  );

drop policy estimate_items_select_own on estimate_items;
create policy estimate_items_select_own on estimate_items
  for select using (
    owner_id = (select auth.uid()) or is_project_member(estimate_item_project(id))
  );

drop policy document_versions_select_own on document_versions;
create policy document_versions_select_own on document_versions
  for select using (
    owner_id = (select auth.uid()) or is_project_member(document_version_project(id))
  );

drop policy status_events_select_own on status_events;
create policy status_events_select_own on status_events
  for select using (
    owner_id = (select auth.uid()) or is_project_member(project_id)
  );

-- ── Revision resets sign-offs ────────────────────────────────────────────────
--
-- Returning a request to draft means the documents changed, so prior internal
-- approvals no longer describe what would be sent. They are cleared; the
-- audit trail survives in status_events, which is append-only history.

create function clear_approvals_on_revision()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'draft' and old.status <> 'draft' then
    delete from change_approvals where change_request_id = new.id;
  end if;
  return new;
end;
$$;

create trigger change_requests_clear_approvals
  before update on change_requests
  for each row execute function clear_approvals_on_revision();

-- ── Invite RPCs ──────────────────────────────────────────────────────────────
--
-- Two functions exposed to signed-in users (PostgREST rpc). Both take the
-- token as their only input — the token is the capability. Everything else
-- (project ids, rosters) stays behind RLS.

-- Minimal, safe preview for the invite landing page.
create function preview_project_invite(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'projectName', p.name,
    'clientName', p.client_name,
    'role', i.role,
    'accepted', i.accepted_at is not null,
    'alreadyMember', exists (
      select 1 from project_members m
      where m.project_id = i.project_id and m.user_id = (select auth.uid())
    )
  )
  from project_invites i
  join projects p on p.id = i.project_id
  where i.token = p_token;
$$;

-- Accept an invite: creates the membership and burns the token. Idempotent
-- for the same user, refused when the token was used by someone else.
create function accept_project_invite(p_token uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invite  project_invites%rowtype;
  v_user    uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'sign in before accepting an invite';
  end if;

  select * into v_invite from project_invites where token = p_token for update;
  if not found then
    raise exception 'this invite link is not valid';
  end if;

  if v_invite.accepted_at is not null then
    if v_invite.accepted_by = v_user then
      return v_invite.project_id;
    end if;
    raise exception 'this invite link has already been used';
  end if;

  if exists (
    select 1 from project_members m
    where m.project_id = v_invite.project_id and m.user_id = v_user
  ) then
    -- Already a member (e.g. the owner following their own link): burn the
    -- token, change nothing.
    update project_invites
      set accepted_at = now(), accepted_by = v_user
      where id = v_invite.id;
    return v_invite.project_id;
  end if;

  insert into project_members (project_id, user_id, role, added_by)
    values (v_invite.project_id, v_user, v_invite.role, v_invite.created_by);

  update project_invites
    set accepted_at = now(), accepted_by = v_user
    where id = v_invite.id;

  return v_invite.project_id;
end;
$$;

-- Helper functions are for policies, not RPCs — but there is a Postgres rule
-- this block must respect: RLS checks EXECUTE on every function a policy
-- calls AS THE QUERYING USER. An earlier revoke-from-everyone version of
-- this block therefore broke every policy-guarded SELECT for signed-in
-- sessions with 42501 "permission denied for function" (policy evaluation
-- itself was refused). So: public/anon get nothing, authenticated gets
-- EXECUTE. The functions are security definer and return only membership
-- booleans and project-id lookups, so calling them directly leaks nothing
-- the policies do not already reveal.
revoke execute on function is_project_member(uuid) from public, anon;
revoke execute on function has_project_role(uuid, member_role[]) from public, anon;
revoke execute on function change_request_project(uuid) from public, anon;
revoke execute on function request_item_project(uuid) from public, anon;
revoke execute on function analysis_run_project(uuid) from public, anon;
revoke execute on function assessment_project(uuid) from public, anon;
revoke execute on function item_review_project(uuid) from public, anon;
revoke execute on function estimate_item_project(uuid) from public, anon;
revoke execute on function document_version_project(uuid) from public, anon;
revoke execute on function change_approval_project(uuid) from public, anon;
revoke execute on function scope_item_project(uuid) from public, anon;
grant execute on function is_project_member(uuid) to authenticated;
grant execute on function has_project_role(uuid, member_role[]) to authenticated;
grant execute on function change_request_project(uuid) to authenticated;
grant execute on function request_item_project(uuid) to authenticated;
grant execute on function analysis_run_project(uuid) to authenticated;
grant execute on function assessment_project(uuid) to authenticated;
grant execute on function item_review_project(uuid) to authenticated;
grant execute on function estimate_item_project(uuid) to authenticated;
grant execute on function document_version_project(uuid) to authenticated;
grant execute on function change_approval_project(uuid) to authenticated;
grant execute on function scope_item_project(uuid) to authenticated;

-- Trigger-invoked only. EXECUTE on trigger functions is checked at CREATE
-- TRIGGER time, not per-statement, so this one CAN stay fully revoked.
revoke execute on function clear_approvals_on_revision() from public, anon, authenticated;

-- The two invite RPCs are for signed-in users only.
revoke execute on function preview_project_invite(uuid) from public, anon;
revoke execute on function accept_project_invite(uuid) from public, anon;
grant execute on function preview_project_invite(uuid) to authenticated;
grant execute on function accept_project_invite(uuid) to authenticated;
