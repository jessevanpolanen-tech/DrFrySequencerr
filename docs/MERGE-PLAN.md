# Merge plan — combine Dr. Fry + FahCel sequencers into one codebase

Comparison of `jessevanpolanen-tech/DrFrySequencerr` (this repo, `drfry`) and
`jessevanpolanen-tech/FahCelSequencing` (`fahcel`), taken from each repo's
default branch. Goal: stop maintaining two divergent copies of the same engine.

## TL;DR

- They are the **same codebase, forked and drifted.** ~18 shared files, most
  differing only in reworded comments and brand strings — but a handful differ
  in real logic.
- **Neither side is a superset.** Each has shipped a **critical fix the other is
  missing**, and both bugs are live in production today.
- **Recommendation: merge the _code_ into one repo, keep _two deployments_**
  (per-brand env + domains). Do **not** collapse into a single deployment.
- Two bugs below should be **hotfixed now**, independent of the larger merge.

---

## 🔴 Two critical bugs — opposite directions

### 1. DrFry re-sends the last email forever (fix lives in FahCel)
`lib/db.js › advanceEnrollment`:

- **FahCel:** `next_due_at = coalesce(<null on completion>::timestamptz, next_due_at)`
- **DrFry:** `next_due_at = <null on completion>` ← writes `null` directly

`db/schema.sql` declares `next_due_at timestamptz NOT NULL` in **both** repos. So
when a sequence completes (e.g. the day-14 break-up), DrFry writes `null` into a
NOT NULL column → the UPDATE throws → the `advance` rolls back → the enrollment
stays `active` on its final step with a due time in the past → **the last email
re-sends on every cron tick.** FahCel's `coalesce` guard is exactly the fix.
DrFry lost it.

### 2. FahCel's cron sends the OTHER brand's emails (fix lives in DrFry)
`lib/db.js › dueEnrollments`:

- **DrFry:** joins `enrollments → leads` and filters `l.tenant = ${tenant}`
- **FahCel:** `select * from enrollments where status='active' and next_due_at <= now()` ← no tenant filter

On the shared database, FahCel's hourly cron picks up **Dr. Fry's** due steps and
sends them from **FahCel's** domain (and races DrFry for the same rows). This is
the "known gap" already noted in `CLAUDE.md`. DrFry has the fix; FahCel doesn't.

> Both fixes are one-liners. They can and should ship to each repo immediately —
> they don't need to wait for the full merge.

---

## Drift map (shared files)

Legend: **=** cosmetic/comment/brand-string only · **→** real logic difference.

| File | Status | What actually differs |
|---|---|---|
| `lib/db.js` | → | **Bug 1 & 2 above.** Also `DEFAULT_TENANT` default (`fahcel` vs `drfry`) and wipe comment. |
| `lib/sequences.js` | → | DrFry: only `founding-outreach`. FahCel: `founding-outreach` **and** `playbook-nurture`. Both hardcode module-level `SITE`/`CONTACT`. |
| `api/cron/tick.js` | → | FahCel logs richer `sent`/`send_failed` meta (`subject`, `text`, `source:'sequence'`); DrFry logs only `{ step }`. |
| `api/leads.js` | → | FahCel joins each `sent` event to its delivered/opened/clicked rows via `resend_id` and returns a `cursor` (real per-message dashboard state). DrFry has the stripped-down version — **no rollup, no cursor**. |
| `api/webhooks/resend-inbound.js` | → | FahCel's forward email reports how many sequences were stopped / "not a lead" / "nothing active"; DrFry hardcodes one message. Plus brand `FORWARD_TO` default. |
| `db/schema.sql` | → | FahCel has `events_id_idx` (for the event tail) and `events_resend_idx` (for the `/api/leads` rollup); DrFry dropped both. Brand strings + tenant default differ. |
| `api/capture-lead.js` | = / minor | DrFry adds `tenant` to the `enrolled` event meta; comment churn. |
| `api/enroll.js` | = | Comment churn only. |
| `api/send.js` | = / minor | Comment + brand churn. |
| `api/unsubscribe.js` | = | Comment/brand churn. |
| `lib/resend.js` | = | Comment/brand churn (`FROM_EMAIL`/`FORWARD_TO` are already env-driven). |
| `lib/webhook.js` | = | Comment churn only. |
| `api/webhooks/resend-events.js` | = | **Identical.** |
| `package.json` | = | Name/description only. |
| `vercel.json` | = | **Identical.** |
| `README.md`, `CLAUDE.md` | = | Brand docs — expected to differ. |

### Files that exist on only one side
| File | Only in | Keep? |
|---|---|---|
| `api/events/since.js` | FahCel | **Yes** — real dashboard event-tail feature. |
| `api/debug.js` | FahCel | No — self-labelled "TEMP … DELETE THIS FILE"; drop or gate behind a secret. |
| `db/fix-leads-unique.sql`, `db/fix-tenant.sql` | FahCel | Fold into a single migrations set. |
| `package-lock.json`, `.gitignore` | FahCel | **Yes** — add to the shared repo. |
| `api/sequence-export.js` | DrFry | **Yes** — plug-and-play export (new). |
| `db/fix-tenant-drfry.sql` | DrFry | Fold into the migrations set. |

**Bottom line:** the real logic drift is concentrated in `db.js`, `tick.js`,
`leads.js`, `resend-inbound.js`, `schema.sql`, `sequences.js`, and the two
FahCel-only endpoints. Everything else is noise.

---

## Recommended architecture

**One shared repo → deployed to two Vercel projects.** Each deployment keeps its
own domain, reply inbox, unsubscribe base, tenant tag, and Resend account, all
via env. The shared Postgres stays; `tenant` keeps rows apart (already in place).

Do **not** merge into a single deployment sending from both domains: it needs a
sender-per-sequence rewrite, per-tenant reply routing, one Resend account holding
every domain, and it puts both brands in one blast radius — complexity you don't
need.

### What becomes env vs. code
- **Per-brand env (already mostly there):** `FROM_EMAIL`, `FROM_NAME`, `REPLY_TO`,
  `FORWARD_TO`, `TENANT`, `BACKEND_BASE_URL`, `RESEND_API_KEY`, webhook secrets,
  `CRON_SECRET`.
- **Code, shared:** the whole engine (`lib/`, `api/`) — one copy, best-of-both.
- **Code, namespaced by brand:** `lib/sequences.js` holds *all* sequences. Both
  repos currently define `founding-outreach` with different copy, so rename to
  avoid collision (e.g. `drfry-founding`, `fahcel-founding`, `fahcel-playbook`)
  and move `SITE`/`CONTACT` out of module-level constants into each sequence.
  Each site passes its own `sequenceId`.

---

## Step-by-step

1. **Hotfix both live bugs first (independent of the merge).**
   - DrFry: add the `coalesce` guard to `advanceEnrollment`.
   - FahCel: add the tenant-scoping join to `dueEnrollments` (and pass `tenant`
     from its `tick.js`).
2. **Choose the home repo.** `DrFrySequencerr` is already declared "source of
   truth" in its `CLAUDE.md`; promote it, or start a neutral repo. (FahCel is not
   push-attached in this session — merging its side needs `add_repo … push` or a
   PR from a fork.)
3. **Land best-of-both on a merge branch:**
   - `db.js`: FahCel's `advanceEnrollment` **+** DrFry's `dueEnrollments`. Make
     `DEFAULT_TENANT` require `process.env.TENANT` (no silent brand default — that
     default is what mislabeled leads in the first place).
   - `tick.js`: FahCel's richer logging.
   - `leads.js`: FahCel's rollup + cursor version.
   - `resend-inbound.js`: FahCel's status-line version.
   - `schema.sql`: include `events_id_idx` + `events_resend_idx`; consolidate the
     `fix-*.sql` migrations.
   - Add `api/events/since.js`; keep `api/sequence-export.js`; drop/guard
     `api/debug.js`.
4. **Namespace sequences** and de-hardcode brand constants (above).
5. **One README** with a per-brand deploy/env table; update `CLAUDE.md` and
   remove the now-fixed "known gap" note.
6. **Repoint both Vercel projects** at the shared repo, each with its own env.
   Redeploy. Confirm the pending actions in `CLAUDE.md` (`TENANT=drfry`,
   `db/fix-tenant-drfry.sql`) are done.
7. **Retire the FahCel repo** (archive) once its Vercel project builds from the
   shared repo.

### Verify after cutover
- Each brand's cron sends **only** its own tenant's steps (bug 2).
- A completed sequence flips to `completed` and does **not** re-send (bug 1).
- `/api/leads` and `/api/events/since` still return per-message state for the
  dashboard.
- A reply / bounce / unsubscribe still stops the sequence on each deployment.

---

## Effort

- **Hotfixes (step 1):** ~15 min each, high urgency, low risk.
- **Full merge (steps 2–7):** ~half a day of code + reconciliation, plus the
  Vercel repointing and a verification pass. Mostly mechanical because the two
  trees are so close; the only judgement calls are sequence namespacing and the
  `DEFAULT_TENANT` policy.
