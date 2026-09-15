-- Verified-output cache for the sample seed's model calls.
--
-- /demo/start runs the real pipeline for every visitor, and its two model
-- calls (extract + analyze) take 40–70s sequentially on inputs that are
-- compile-time constants — the sample scope text and client message never
-- change. This table lets the seed serve the first *verified* live output to
-- every later visitor, cutting the demo from ~66s to a few seconds while the
-- citations stay genuinely model-produced and genuinely verified.
--
-- The cache key is a SHA-256 over every input to the call (operation, model,
-- system prompt, user prompt, schema name), computed in lib/ai/provider.ts —
-- so a prompt, model, or document change can never serve a stale answer.
--
-- Trust model: rows are read AND written through the visitor's own session
-- (anonymous sign-ins carry the authenticated role), which means any signed-in
-- visitor could insert rows here directly via the REST API. That is tolerable
-- because a cached payload is NEVER trusted on read: provider.generate()
-- re-runs the schema parse and the caller's validate() — the same citation
-- verification that gates live model output, against the same public sample
-- text — and treats a failing row as a miss. A hostile row can only produce
-- output that passes full verification; it cannot inject unverified claims.
-- Nothing private is ever cached: only the sample seed passes a cache, and
-- its inputs are public constants.
--
-- Rows are deliberately immutable (no update/delete policies): a cache entry
-- records what the model produced, and rewriting history is not a feature.

create table model_output_cache (
  cache_key  text primary key,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

alter table model_output_cache enable row level security;

create policy "model cache is readable by signed-in visitors" on model_output_cache
  for select to authenticated using (true);

create policy "model cache rows can be added by signed-in visitors" on model_output_cache
  for insert to authenticated with check (true);
