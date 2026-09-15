# Contributing to ScopeGuard

ScopeGuard is a hackathon build, but it is built like a product: every claim the
UI makes is enforced in code, and the tests exist to keep it that way. This
document is how to work on it without breaking that.

## Setup

```bash
npm install
cp .env.example .env.local      # add your Supabase URL + anon key
```

- **Node.js 24+** is required. The codebase relies on native TypeScript
  execution (type-stripping only — relative imports keep their `.ts`
  extensions) and the built-in test runner.
- Create a free [Supabase](https://supabase.com) project, run the migrations in
  `supabase/migrations/` in order, and enable **Authentication → Anonymous
  sign-ins**.
- An OpenAI API key is optional — without it the app runs in fixture mode and
  the whole workflow still works offline.
- To work on the Slack integration locally, follow
  **README → "Local development and Slack OAuth"** (hosts-file domain + mkcert;
  Slack refuses bot-scope OAuth on localhost redirect URIs).

## Commands

```bash
npm run dev         # dev server
npm test            # 107 unit tests
npm run eval        # 23 labelled eval cases (fixture mode)
npm run eval -- --live   # against the live model (needs OPENAI_API_KEY)
npm run typecheck   # tsc --noEmit
npm run lint
npm run build       # production build — must pass before a PR
```

**Verification quirk:** tests and eval run under `--conditions=react-server`
(it is in the npm scripts). If you invoke `node --test` or `eval/run.ts`
directly without that flag, imports of `next/headers` and other server-only
modules will fail confusingly.

## The invariants — changes must not weaken these

Everything else in this codebase is negotiable; these five are not. If your
change touches one of them, it needs a very good reason and a test.

1. **A displayed quote is always verbatim in the source document.**
   `lib/ai/citations.ts` normalizes and verifies; a quote that does not match
   is rejected, never displayed. The character folding is strictly 1:1 — do not
   add a fold that changes string length.

2. **Absence from the document is never treated as exclusion.**
   `applyEvidenceRules()` in `lib/ai/analyze-request.ts` downgrades any strong
   label without verified evidence to `needs_clarification`. The downgrade is
   one-directional on purpose.

3. **The model never supplies a number.** The work-breakdown schema has no
   hours/cost/date field; hours stay NULL until a human types them; generated
   prose is scanned for currency/duration/date claims and cleared.

4. **AI output, human decisions, and finalized documents are separate
   records.** `assessments` are append-only, `item_reviews` are the human's,
   `document_versions` freeze on finalize. Re-running analysis must never
   mutate a review.

5. **It never contacts the client, and a notification can never change a
   figure or a status.** Integrations announce; they do not act.

## Conventions

- **Money:** `BigInt` on integer minor units (`lib/money.ts`), half-up
  rounding. Never float. `computeTotals()` is the only totals formula — the
  screen, the reply, the change order, and the invoice all call it.
- **Persistence:** every query goes through `lib/data/` as the signed-in user.
  There is no service-role key in this codebase, by design. New tables need
  RLS policies and an owner check on writes.
- **Migrations:** additive and ordered (`000N_description.sql`). Never edit an
  applied migration — add a new one. Test it against the live project before
  committing.
- **AI calls:** strict `json_schema`, bounded retries, untrusted text fenced as
   data in the prompt (`lib/ai/prompts.ts`). A new model operation needs a
   fixture-mode stand-in that goes through the same verification path.
- **Components:** shadcn/ui primitives via the `components/ui` barrel;
   native form inputs for server-action forms. Match the existing comment
   density — the comments explain *why* (often a bug that once happened), not
   *what*.
- **Tests:** colocated (`foo.test.ts` next to `foo.ts`). A behavior worth
   adding is a behavior worth testing — especially a failure mode. The tests
   double as the executable spec for the invariants above.

## Submitting changes

1. Branch, make the change, add or update tests.
2. `npm test && npm run typecheck && npm run build` — all green, no exceptions.
3. `npm run eval` — safety invariants must hold (evidence-rule violation count
   must stay 0). Label agreement in fixture mode is informational.
4. PR with a short description of *what behavioral promise* the change keeps
   or adds.

## What is deliberately not built

Automatic client messaging, e-signatures, payment processing, multi-currency
conversion, multi-agent orchestration, vector search, and AI-generated hours
as reliable figures are all **out of scope on principle**, not for lack of
time — see README → "What ScopeGuard does not do". PRs adding them will not
be merged.
