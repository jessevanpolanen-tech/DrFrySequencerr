# Lead intelligence: search results → qualified, personalised leads

SerpApi finds companies. This layer works out whether each one fits, who to
write to, and why now, and only then lets it into a sequence.

```
POST /api/intel/discover   SerpApi search → entity resolver → prospects (discovered)
        │
POST /api/intel/process    (or the daily /api/cron/intel), one stage at a time:
        │   discovered ─ crawl site (robots-aware), find website for LinkedIn-only hits
        │   crawled    ─ enrichment waterfall (Apollo → Hunter → site emails) + news signals
        │   enriched   ─ rule score + Claude qualification  → rejected | qualified
        │   qualified  ─ pick contact, verify email, Claude opener → ready | review | no_contact
        │
GET  /api/intel/prospects  triage: best fit first, with reasons, evidence and opener
        │
POST /api/intel/promote    human decision → lead (+ leads.intel) → optional `<tenant>-signal` sequence
        │
     /api/cron/tick        sends it, exactly like every other sequence
```

Prospects live in their own table, not `leads`, so unqualified search hits never
show up in the dashboard or reach a sequence by accident. Nothing here sends
email. Promotion is always an explicit call.

## Setup

1. **Schema:** run `db/intel-schema.sql` in Supabase after `db/schema.sql`. It is idempotent.
2. **Env** (Vercel → `dr-fry-sequencerr`; shared by every brand):

| Var | Required | What it does |
|---|---|---|
| `INTEL_SECRET` | ✅ | Bearer token for every `/api/intel/*` route. Unset means the routes refuse (503). |
| `SERPAPI_KEY` | ✅ | Discovery, finding the website for LinkedIn-only hits, and news signals |
| `ANTHROPIC_API_KEY` | recommended | Claude qualification and personalisation. Without it: rule score only, generic copy. |
| `INTEL_MODEL` | — | Default `claude-opus-5-5` |
| `INTEL_EFFORT` | — | Default `low` (classification-shaped work). Raise it if verdicts look shallow. |
| `HUNTER_API_KEY` | recommended | Named people + work emails, **and** mailbox verification. Without it nothing reaches `ready`, only `review`. |
| `APOLLO_API_KEY` | — | Firmographics (size, industry, country, tech) |
| `INTEL_TENANTS` | — | e.g. `fahcel`. Brands the daily cron processes. Unset means the cron does nothing. |
| `INTEL_SIGNALS` | — | `off` skips the per-prospect news search (saves 1 SerpApi credit each) |

ICPs (who each brand targets, presets, competitor exclusions, title keywords)
are in `lib/intel/icp.js`. A tenant without an ICP is refused, never defaulted.

## Use

```bash
B=https://dr-fry-sequencerr.vercel.app; H="Authorization: Bearer $INTEL_SECRET"

# presets for a brand
curl -H "$H" "$B/api/intel/discover?tenant=fahcel"

# discover (1 SerpApi credit per page) and run a first batch straight away
curl -H "$H" -H 'Content-Type: application/json' -X POST $B/api/intel/discover \
  -d '{"tenant":"fahcel","preset":"nl-pharma-wholesale","pages":2,"process":true}'
# …or a free-form query
  -d '{"tenant":"fahcel","query":"site:linkedin.com/in \"QA Manager\" pharmaceutical Netherlands"}'

# keep processing (call until nothing is left in the active stages, or leave it to the cron)
curl -H "$H" -H 'Content-Type: application/json' -X POST $B/api/intel/process -d '{"tenant":"fahcel","limit":10}'

# review what's ready
curl -H "$H" "$B/api/intel/prospects?tenant=fahcel&stage=ready"

# promote and start the signal-led sequence
curl -H "$H" -H 'Content-Type: application/json' -X POST $B/api/intel/promote \
  -d '{"tenant":"fahcel","ids":["<uuid>"],"enroll":true}'
# `review` prospects (catch-all / unverified mailbox) need "allowRisky":true

# park or retry one
curl -H "$H" -H 'Content-Type: application/json' -X PATCH $B/api/intel/prospects \
  -d '{"tenant":"fahcel","id":"<uuid>","action":"requeue"}'
```

## Guarantees

- **Grounded personalisation.** The opener may cite only what is in the
  crawled site or the news hits, and it stores `evidence_url` so you can check.
  No trigger in the evidence means `trigger` stays empty and the opener draws
  on their own site.
- **Untrusted input.** Website and news text are fenced as data in the prompt
  and the output is schema-constrained. Because a page can still try to steer
  the model, a human reads the opener before `promote`.
- **Suppression.** `promote` skips any address that ever unsubscribed, bounced
  or complained (on any brand), is already another brand's lead, or already
  has an active sequence.
- **Deliverability.** Only a verifier-confirmed mailbox is `ready`.
  Catch-all, unknown and unverified addresses go to `review`.
- **Resumable.** Each stage saves before the next starts. Claims use a
  two-minute lease with `skip locked`, so the cron and a manual call never
  process the same row. A stage that keeps failing parks as `failed` after 4
  attempts, with the error recorded.
- **Dedup.** One prospect per (tenant, domain). Domains of existing leads are
  skipped at discovery.
- **Signal sequences.** `fahcel-signal` / `drfry-signal` use the founding copy
  and cadence. Step 1 leads with the opener and subject from `leads.intel`.
  With no intel, it is byte-identical to the founding intro.

## Cost per prospect (rough)

SerpApi: 1 credit (news), plus 1 more when the hit was LinkedIn-only. Discovery
pages are shared across the ~5–10 companies each page yields. Claude: two
low-effort calls of ~3–4k input tokens each. Hunter: 1 domain search + 1–3
verifications.

## Not built (extension points)

- Apollo **people** search: add a provider to `PROVIDERS` in `lib/intel/enrich.js`.
- Scheduled discovery: deliberately manual, because it spends credits on a
  query someone should choose.
- Dashboard Prospects tab: needs a way to hold `INTEL_SECRET` that isn't the
  public static bundle.
- **Legal:** cold B2B email to named EU individuals relies on legitimate
  interest (GDPR) plus the unsubscribe footer every sequence already carries.
  Keep the discovery source (`source_query`, `discovery`) as your record of
  where each address came from.
