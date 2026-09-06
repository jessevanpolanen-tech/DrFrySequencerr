# Dr. Fry sequencer — backend (source of truth)

This repo **is** the Dr. Fry cold-outreach backend. It deploys to Vercel at
`dr-fry-sequencerr.vercel.app`.

- The marketing site (`DrFryWebsite24June`) has **no backend of its own** — its
  `vercel.json` rewrites `/api/*` to this deployment.
- The `backend/` folder that lives inside the `DrFryWebsite24June` repo is **dead
  duplicate code** — it deploys nothing. Never edit it; only edit this repo.

## Shared database — multi-tenant

Dr. Fry and FahCel (`FahCelSequencing`) share **one** Postgres. Rows are kept apart
by `leads.tenant` (`drfry` | `fahcel`). This deployment must run as tenant `drfry`.
Capture, the dashboard read, the wipe, and the cron are all scoped by tenant.

## ⚠️ Pending deploy actions — do these when the tenant-scoping branch merges

1. **Set `TENANT=drfry`** in Vercel → this project → Environment Variables, then
   redeploy. Without it, new leads default to `fahcel` on the shared DB and the
   cron / wipe / dashboard read mis-scope across brands.
2. **Run `db/fix-tenant-drfry.sql`** in Supabase (SQL editor): STEP 0 review →
   STEP 1 re-tag → STEP 2 verify the `group by tenant` counts. It moves the
   Dr. Fry leads currently mislabeled `fahcel` back to `drfry`.

## Known gap — NOT in this repo

`FahCelSequencing`'s `dueEnrollments()` is **not** tenant-scoped, so its cron will
pick up Dr. Fry's due steps and send them from FahCel's domain. Apply the same
`lib/db.js` join fix there and set `TENANT=fahcel` on that deployment.
