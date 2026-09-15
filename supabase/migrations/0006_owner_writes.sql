-- Owner-only writes on working tables (companion to 0005_teams).
--
-- 0005 gave project members SELECT on the twelve working tables. That makes
-- the INSERT policies' plain `owner_id = auth.uid()` check insufficient: it
-- only proves the row belongs to its writer, not that the writer owns the
-- PROJECT the row belongs to. A member (or anyone who knows a project id)
-- could insert estimate lines or request items carrying their own uid, and
-- once reads are membership-scoped those rows would appear on the owner's
-- screen and in their exports.
--
-- The app's model is that every working row carries the PROJECT OWNER's id —
-- the seeding, capture and estimate paths all write as the owner after
-- verifying ownership. These policies make that a database invariant:
--
--   INSERT is allowed only when the writer owns the project the row lands in.
--
-- UPDATE and DELETE need no change: they match on owner_id, and a member's
-- uid is never the owner_id of a working row.
--
-- status_events is the one exception: the audit trail accepts entries from
-- any project member (the internal-approval flow records an approver's act),
-- and each row carries its writer's id, so a forged entry is at least
-- attributable. Everything else stays owner-only.

create function owns_project(p_project uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = p_project and p.owner_id = (select auth.uid())
  );
$$;

create function scope_version_project(p_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select sv.project_id from scope_versions sv where sv.id = p_id;
$$;

-- Same rule as 0005: policies call these as the querying user, so
-- authenticated needs EXECUTE or every INSERT above fails with 42501.
-- (owns_project is also called by an INSERT policy a project MEMBER can
-- reach — status_events — so the grant is not optional.)
revoke execute on function owns_project(uuid) from public, anon;
revoke execute on function scope_version_project(uuid) from public, anon;
grant execute on function owns_project(uuid) to authenticated;
grant execute on function scope_version_project(uuid) to authenticated;

drop policy scope_documents_insert_own on scope_documents;
create policy scope_documents_insert_own on scope_documents
  for insert with check (owner_id = (select auth.uid()) and owns_project(project_id));

drop policy scope_versions_insert_own on scope_versions;
create policy scope_versions_insert_own on scope_versions
  for insert with check (owner_id = (select auth.uid()) and owns_project(project_id));

drop policy scope_items_insert_own on scope_items;
create policy scope_items_insert_own on scope_items
  for insert with check (
    owner_id = (select auth.uid())
    and owns_project(scope_version_project(scope_version_id))
  );

drop policy change_requests_insert_own on change_requests;
create policy change_requests_insert_own on change_requests
  for insert with check (owner_id = (select auth.uid()) and owns_project(project_id));

drop policy request_items_insert_own on request_items;
create policy request_items_insert_own on request_items
  for insert with check (
    owner_id = (select auth.uid())
    and owns_project(change_request_project(change_request_id))
  );

drop policy analysis_runs_insert_own on analysis_runs;
create policy analysis_runs_insert_own on analysis_runs
  for insert with check (
    owner_id = (select auth.uid())
    and owns_project(change_request_project(change_request_id))
  );

drop policy assessments_insert_own on assessments;
create policy assessments_insert_own on assessments
  for insert with check (
    owner_id = (select auth.uid())
    and owns_project(request_item_project(request_item_id))
  );

drop policy item_reviews_insert_own on item_reviews;
create policy item_reviews_insert_own on item_reviews
  for insert with check (
    owner_id = (select auth.uid())
    and owns_project(request_item_project(request_item_id))
  );

drop policy estimate_items_insert_own on estimate_items;
create policy estimate_items_insert_own on estimate_items
  for insert with check (
    owner_id = (select auth.uid())
    and owns_project(change_request_project(change_request_id))
  );

drop policy document_versions_insert_own on document_versions;
create policy document_versions_insert_own on document_versions
  for insert with check (
    owner_id = (select auth.uid())
    and owns_project(change_request_project(change_request_id))
  );

-- The audit trail accepts entries from any member of the project; the row
-- records who wrote it. (Approvals recorded by approver teammates land here.)
drop policy status_events_insert_own on status_events;
create policy status_events_insert_own on status_events
  for insert with check (
    owner_id = (select auth.uid()) and is_project_member(project_id)
  );
