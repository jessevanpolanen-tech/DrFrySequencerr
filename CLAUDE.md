# Sequencer backend — shared multi-brand source of truth

This repo is the **one** cold-outreach sequencer codebase, shared by every
brand. Each brand runs its **own Vercel deployment** off this same repo, with
its own env (sender domain, tenant, keys) — Dr. Fry at
`dr-fry-sequencerr.vercel.app`, FahCel at its own project. Do not fork it again;
edit here and let both deployments build from it. (The old `FahCelSequencing`
repo is retired once its Vercel project is repointed here.)

- The marketing site (`DrFryWebsite24June`) has **no backend of its own** — its
  `vercel.json` rewrites `/api/*` to the Dr. Fry deployment.
- The `backend/` folder inside the `DrFryWebsite24June` repo is **dead duplicate
  code** — it deploys nothing. Never edit it; only edit this repo.

## Shared database — multi-tenant

All brands share **one** Postgres. Rows are kept apart by `leads.tenant`
(`drfry` | `fahcel` | …). Each deployment must set `TENANT` to its own brand —
there is **no default**; `lib/db.js` throws if `TENANT` is unset, so a
misconfigured deploy fails loudly instead of mislabeling leads. Capture, the
dashboard read, the wipe, and the cron are all scoped by tenant.

## One codebase, per-brand config

Everything brand-specific is env-driven — `FROM_EMAIL`, `FROM_NAME`, `REPLY_TO`,
`FORWARD_TO`, `TENANT`, `BACKEND_BASE_URL`, `RESEND_API_KEY`, webhook secrets,
`CRON_SECRET`, `EXPORT_SECRET`. No brand defaults live in code. Sequences are
namespaced by brand in `lib/sequences.js` (`drfry-founding`, `fahcel-founding`,
`fahcel-playbook`); a caller that names no `sequenceId` gets `<tenant>-founding`.

## Lead intelligence (`lib/intel/`, `api/intel/`)

Upstream of the sequencer: SerpApi discovery → prospects (own table, never
`leads`) → crawl → enrichment waterfall → rule + Claude qualification →
verified contact + grounded opener → **human** `POST /api/intel/promote` →
lead with `leads.intel` → `<tenant>-signal` sequence. Full doc:
`docs/LEAD-INTELLIGENCE.md`. Rules that hold it together:
- Tenant is **required** on every intel call and must have an ICP in
  `lib/intel/icp.js`. Never default it from `TENANT`.
- **Hobby plan: max 12 serverless functions per deployment** (10 existed before intel). Over the cap the deploy fails for every brand. All intel routes are one dynamic function, `api/intel/[action].js`, dispatching to `lib/intel/routes/`. Add routes there, never as new files under `api/`. `npm test` enforces the cap.
- `/api/intel/*` refuse without `INTEL_SECRET`. They spend credits and return
  scraped contact data, unlike the open `/api/leads`.
- Nothing in `lib/intel` sends email or enrolls automatically. Keep it that way.
- Website/news text is untrusted model input: keep it fenced in the prompt and
  the output schema-constrained.
- Tests: `npm test` (node's runner, no network/DB).

## ⚠️ Cutover / pending deploy actions

Do these when this merge deploys (order matters — code first, then migrations):

1. **Set `TENANT`** on every deployment (`drfry` on the Dr. Fry project,
   `fahcel` on the FahCel project). Required — the app throws without it.
2. **Run `db/migrate-namespace-sequences.sql`** in Supabase *after* deploy: it
   re-tags in-flight enrollments from the old `founding-outreach` /
   `playbook-nurture` ids to the new brand-namespaced ids, so active sequences
   keep running instead of being paused.
3. **Run `db/fix-tenant-drfry.sql`** (STEP 0 review → STEP 1 re-tag → STEP 2
   verify counts) if not already done — it moves Dr. Fry leads mislabeled
   `fahcel` back to `drfry`.
4. **Repoint FahCel's Vercel project** to this repo with FahCel's env, redeploy,
   then archive the old `FahCelSequencing` repo.

## Fixed — the two forks' cross-brand bugs

Both are resolved in this shared codebase:
- **Infinite resend on completion** — `advanceEnrollment` now guards
  `next_due_at` with `coalesce(...)`, so a completed sequence persists as
  `completed` instead of re-sending its last email every tick.
- **Cron cross-sending** — `dueEnrollments()` joins `leads` and filters by
  `tenant`, so a deployment's cron only ever sends its own brand's steps.
  (Also ported to the interim `FahCelSequencing` deploy until it repoints here.)
