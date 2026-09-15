-- Per-user integration credentials (Slack OAuth first).
--
-- The SaaS-shaped answer to "users connect their own integrations": each
-- user authorizes ScopeGuard through the provider's OAuth flow and the
-- resulting token lands here, scoped to that user by RLS. The operator-wide
-- env vars (SLACK_BOT_TOKEN / SLACK_NOTIFY_CHANNEL) remain as a fallback for
-- self-hosted single-workspace deployments — a user's own connection always
-- takes precedence over them.
--
-- Tokens are stored encrypted (AES-256-GCM, see lib/integrations/secret-box);
-- the key lives in the server environment and never in this database. A
-- stolen database dump must not yield usable Slack tokens.

create table integration_credentials (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  provider        text not null check (provider in ('slack')),
  -- Packed AES-256-GCM value: "v1:<iv>:<tag>:<ciphertext>", all base64.
  access_token_enc text not null,
  -- Provider-specific settings the user chose (Slack's notify channel,
  -- workspace name). No secrets in here.
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner_id, provider)
);

create index integration_credentials_owner_idx on integration_credentials (owner_id);

create trigger integration_credentials_touch before update on integration_credentials
  for each row execute function touch_updated_at();

alter table integration_credentials enable row level security;

-- Owner-only, all four operations: a credential is one user's connection to
-- their own workspace. There is deliberately no project-membership path — a
-- teammate never reads or borrows another user's Slack token, not even on a
-- project they share.
create policy "integration credentials are readable by owner" on integration_credentials
  for select using (owner_id = (select auth.uid()));
create policy "integration credentials are insertable by owner" on integration_credentials
  for insert with check (owner_id = (select auth.uid()));
create policy "integration credentials are updatable by owner" on integration_credentials
  for update using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "integration credentials are deletable by owner" on integration_credentials
  for delete using (owner_id = (select auth.uid()));
