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
`fahcel-playbook`, `kavel-founding`, plus generated `drfry-signal` /
`fahcel-signal`); a caller that names no `sequenceId` gets `<tenant>-founding`.
Brand copy constants (site, contact, footer line) live in `BRAND` there.

## How it works

Vercel serverless functions (Node runtime, classic `(req, res)` handlers, no
build step: React Email is called via `createElement`, never JSX) on one
Postgres, sending through Resend.

1. **Lead in.** `POST /api/capture-lead` (public site forms, CORS always `*`,
   enrolls only with `enroll:true`), `POST /api/enroll` (dashboard, always
   enrolls) or `POST /api/send` (one manual email; upserts the recipient as a
   lead). Each upserts `leads`, writes an `enrollments` row
   (`step_index` = next step to send, `next_due_at` = enrolled_at + `dayOffset`
   days) and logs `events`. A *new* lead triggers a notification email.
2. **Send.** Vercel Cron hits `/api/cron/tick` (`vercel.json`: daily 08:00 UTC,
   because Hobby crons are daily at most). It takes up to **50** due active
   enrollments *for this deployment's `TENANT`*, renders the step (plain text
   from `lib/sequences.js` + HTML from `lib/email-layout.js`), sends it, logs
   `sent` with the Resend id, then advances or completes. A failed send stays
   due and retries next tick. Every body ends with an unsubscribe link built on
   `BACKEND_BASE_URL`.
3. **Stop.** `/api/webhooks/resend-events` logs delivered/opened/clicked and
   stops sequences on bounce/complaint. `/api/webhooks/resend-inbound`
   (`email.received` on the brand's receiving subdomain, which `REPLY_TO` points
   at) stops on reply and forwards the reply to `FORWARD_TO` with Reply-To set
   to the lead. `/api/unsubscribe?t=<base64url email>` stops on opt-out.
4. **Read.** `GET /api/leads?tenant=` returns leads with their latest
   enrollment, engagement rollup and per-message status (joined on
   `resend_id`) plus a `cursor`; `GET /api/events/since?cursor=` tails new
   events. `GET /api/sequence-export` dumps sequence copy with merge tags.

Coding rules that keep this working:
- **One query at a time.** `lib/db.js` runs `max: 1` with `prepare: false` on
  Supabase's transaction pooler (port 6543). Concurrent queries
  (`Promise.all`) on that connection wedge the instance. Keep DB calls sequential.
- **Function cap.** 11 of 12 Hobby functions are used. New endpoints go into an
  existing dynamic route, never a new file under `api/`.
- `lib/db.js` reads `TENANT` at import, so a missing `TENANT` 500s every route
  that imports it (all but `/api/sequence-export`).

Gaps to know about (not yet fixed):
- Webhooks, unsubscribe and suppression act **by email across all tenants**: a
  reply/bounce/unsub stops that address's sequences on every brand.
- `leads.email` is globally unique and a lead's tenant is fixed at first insert.
  Enrolling an address that already belongs to another brand attaches the
  enrollment to *that* brand's lead, so the other brand's cron sends it.
- Any caller can pass `tenant` in body/query to capture, enroll, send, read
  or wipe another brand's rows. `/api/leads` (GET and the `DELETE_ALL_LEADS`
  wipe), `/api/enroll` and `/api/send` have no auth beyond CORS.
- `api/unsubscribe.js` and the Markdown title in `api/sequence-export.js`
  still hardcode Dr. Fry branding; `sequence-export` falls back to the Dr. Fry
  URL when `BACKEND_BASE_URL` is unset.

## Environment variables

Set in Vercel → Project → Settings → Environment Variables, **per deployment**,
then redeploy. Every deployment points at the same database; everything else is
that brand's own.

**Sequencer (every brand's deployment):**

| Var | Need | Used for · what happens if unset |
|---|---|---|
| `TENANT` | **required** | `drfry` \| `fahcel` \| `kavel`. Scopes cron, reads, wipe and default sequence. Unset: every DB route throws. |
| `POSTGRES_URL` | **required** | Shared Supabase *transaction pooler* string (`…pooler.supabase.com:6543/postgres`). `DATABASE_URL`, then `SUPABASE_DB_URL` are fallbacks. Same value on all deployments. |
| `RESEND_API_KEY` | **required** | All sends, plus fetching inbound reply bodies. |
| `FROM_EMAIL` | **required** | Verified sender on the brand's sending subdomain (e.g. `jesse@contact.drfry.nl`). Unset: every send throws. |
| `FROM_NAME` | optional | Sender display name (e.g. `Dr. Fry`). |
| `REPLY_TO` | required for auto-stop | An address on the brand's Resend **Inbound** subdomain (e.g. `…@reply.drfry.nl`). Unset: replies go to `FROM_EMAIL`, never hit the inbound webhook, so sequences don't stop on reply. `/api/send` ignores any client-supplied reply-to. |
| `FORWARD_TO` | required | Real mailbox for forwarded replies and (fallback) new-lead notifications. Unset: forwards fail (logged `forward_failed`) and notifications are silently skipped. |
| `NOTIFY_TO` | optional | New-lead notification recipient; defaults to `FORWARD_TO`. |
| `BACKEND_BASE_URL` | recommended | This deployment's public URL, the base of every unsubscribe link. Unset: tick uses the request host. |
| `CRON_SECRET` | **required in prod** | Guards `/api/cron/tick` and `/api/intel/cron` (Vercel Cron sends it as `Bearer` automatically; manual: `?key=`). Unset: both are open. |
| `EXPORT_SECRET` | optional | Guards `/api/sequence-export`; falls back to `CRON_SECRET`. Neither set: open. |
| `RESEND_WEBHOOK_SECRET_EVENTS` | **required in prod** | `whsec_…` of the events webhook. |
| `RESEND_WEBHOOK_SECRET_INBOUND` | **required in prod** | `whsec_…` of the inbound webhook. (`RESEND_WEBHOOK_SECRET` is a third accepted slot; any match passes.) None set: signatures aren't checked, so anyone can forge replies/bounces. |
| `ALLOW_ORIGIN` | optional | CORS origin for dashboard/intel routes; default `*`. |

**Lead intelligence** (only on a deployment that runs intel; details in
`docs/LEAD-INTELLIGENCE.md`). Routes take `tenant` per request, so one
deployment can serve every brand that has an ICP (`drfry`, `fahcel`):

| Var | Need | Used for · what happens if unset |
|---|---|---|
| `INTEL_SECRET` | **required** | Bearer for `/api/intel/*`. Unset: routes return 503. |
| `SERPAPI_KEY` | **required** | Discovery, website lookup for LinkedIn hits, news signals. |
| `ANTHROPIC_API_KEY` | recommended | Claude qualification + opener. Unset: rule score only, generic copy. |
| `HUNTER_API_KEY` | recommended | People/emails and mailbox verification. Unset: nothing reaches `ready`, only `review`. |
| `APOLLO_API_KEY` | optional | Firmographics. |
| `INTEL_TENANTS` | optional | Comma list the daily `/api/intel/cron` (06:00 UTC) processes. Unset: cron no-ops. List each brand on one deployment only. |
| `INTEL_MODEL` / `INTEL_EFFORT` | optional | Default `claude-opus-5-5` / `low`. |
| `INTEL_SIGNALS` | optional | `off` skips the per-prospect news search (1 SerpApi credit each). |

Outside env, each brand also needs in Resend: a verified sending domain, an
events webhook (`delivered, opened, clicked, bounced, complained`) →
`/api/webhooks/resend-events`, a receiving subdomain (MX) with an
`email.received` webhook → `/api/webhooks/resend-inbound`, and open/click
tracking on. Database: `db/schema.sql`, then `db/intel-schema.sql` (both idempotent).

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
