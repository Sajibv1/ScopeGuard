-- Tax line on change requests (§8 "tax calculations", honest version).
--
-- The product rule that made plain "tax calculations" a refusal is that the
-- machine never supplies a number the client could rely on. This design keeps
-- that rule: the RATE and LABEL are entered by a human, exactly like hours and
-- rates on estimate lines. The application only does decimal-safe arithmetic
-- on what was entered, through the same computeTotals() the estimate table and
-- every export already use.
--
--   tax_label  free text, e.g. "VAT" or "Sales tax (TX)"
--   tax_rate   percent, 0–100, at most 2 decimals (parseDecimal enforces this)
--
-- A NULL rate means no tax row is rendered anywhere — subtotal stays the total.

alter table change_requests
  add column tax_label text check (tax_label is null or length(btrim(tax_label)) between 1 and 40),
  add column tax_rate  numeric(5, 2) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100));

comment on column change_requests.tax_rate is
  'User-entered tax rate in percent. The application computes the amount; it never chooses the rate.';

-- ── Drift repair ─────────────────────────────────────────────────────────────
-- The live project also carries this revoke (applied 2026-09-11 as the
-- "security_hardening" migration, which has no local file). It is repeated
-- here so a fresh database from these files matches live.

revoke execute on function public.rls_auto_enable() from public;
