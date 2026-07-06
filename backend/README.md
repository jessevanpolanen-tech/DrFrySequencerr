# Dr. Fry — cold-outreach sequencer (on Resend)

Automatic, reply-aware email sequences on top of your Resend account.
Sends from `jesse@contact.drfry.nl` (your verified subdomain), keeps replies in
your Outlook, stops on reply/bounce/unsubscribe, and tracks clicks.

> ⚠️ These are **backend files you deploy** — they don't run inside the design
> project. Deploy them once to Vercel and they run 24/7 on their own.

## What each piece does

| File | Role |
|---|---|
| `db/schema.sql` | Tables: `leads`, `enrollments`, `events`. Run once. |
| `api/enroll.js` | `POST /api/enroll` — add a lead + start a sequence. |
| `api/cron/tick.js` | Runs hourly (Vercel Cron). Sends due steps, advances each lead. |
| `api/webhooks/resend-events.js` | Opens / clicks / bounces / complaints from Resend. |
| `api/webhooks/resend-inbound.js` | A reply → stop sequence **and** forward to your Outlook. |
| `api/unsubscribe.js` | The opt-out link in every email footer. |
| `api/leads.js` | `GET /api/leads` — read live pipeline state (for the dashboard). |
| `lib/sequences.js` | Your sequences + copy. Edit here to change cadence/wording. |

Default sequence `founding-outreach`: **Day 0** intro → **Day 3** case study →
**Day 7** ROI → **Day 14** break-up. Change it in `lib/sequences.js`.

## Deploy (≈20 min)

### 1. Database
Create a Postgres DB — easiest is **Vercel Postgres** (Storage tab in Vercel), or
Neon / Supabase. Then load the schema:
```bash
psql "$POSTGRES_URL" -f db/schema.sql
```
(or paste `db/schema.sql` into the provider's SQL console).

### 2. Deploy to Vercel
```bash
npm i -g vercel
cd backend
vercel            # first deploy → gives you https://your-app.vercel.app
vercel --prod
```

### 3. Environment variables (Vercel → Settings → Environment Variables)
| Var | Value |
|---|---|
| `RESEND_API_KEY` | your Resend key (`re_...`) |
| `POSTGRES_URL` | auto-set by Vercel Postgres; else paste the pooled URL |
| `FROM_EMAIL` | `jesse@contact.drfry.nl` |
| `FROM_NAME` | `Dr. Fry` |
| `REPLY_TO` | `replies@contact.drfry.nl` *(see step 5 — must be an inbound address for reply-detection)* |
| `FORWARD_TO` | `jesse@drfry.nl` (your Outlook) |
| `CRON_SECRET` | any long random string |
| `RESEND_WEBHOOK_SECRET` | the `whsec_...` shown when you create each webhook |
| `BACKEND_BASE_URL` | `https://your-app.vercel.app` |
| `ALLOW_ORIGIN` | your dashboard's origin (or `*` while testing) |

Redeploy after setting them: `vercel --prod`.

### 4. Resend webhook — events
Resend → **Webhooks** → add endpoint
`https://your-app.vercel.app/api/webhooks/resend-events`, subscribe to
`email.delivered`, `email.opened`, `email.clicked`, `email.bounced`,
`email.complained`. Copy its signing secret into `RESEND_WEBHOOK_SECRET`.
Then turn **ON open & click tracking** in Resend settings.

### 5. Reply detection (the important bit)
So a reply stops the sequence *and* still reaches Outlook, replies must route
through Resend, not straight to your inbox:

1. In Resend, set up **Inbound** for an address on your subdomain, e.g.
   `replies@contact.drfry.nl` (add the MX record Resend gives you).
2. Point its inbound webhook at
   `https://your-app.vercel.app/api/webhooks/resend-inbound`.
3. Set `REPLY_TO=replies@contact.drfry.nl`.

Now: lead replies → Resend inbound → we stop their sequence and **forward the
message to `jesse@drfry.nl`** with Reply-To set to the lead, so you answer
normally from Outlook. If you skip this, sending still works but sequences won't
auto-stop on reply — set `REPLY_TO=jesse@drfry.nl` and just watch replies by hand.

### 6. Test
```bash
curl -X POST https://your-app.vercel.app/api/enroll \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","name":"Test","org":"Acme"}'

# fire the scheduler manually instead of waiting for the hour:
curl "https://your-app.vercel.app/api/cron/tick?key=YOUR_CRON_SECRET"
```
You should receive step 0. Reply to it → you get the forward in Outlook and the
sequence stops.

## Connecting the dashboard
The dashboard's **Add cold outreach lead** button can `POST /api/enroll` to start
a real sequence, and a pipeline view can `GET /api/leads` for live status. Ask to
have that wired once this backend is deployed and you have the URL.

## Safety notes
- **Sending domain:** everything goes out on `contact.drfry.nl`, so cold-outreach
  reputation never touches `drfry.nl` or your Outlook.
- **Compliance:** every email carries a working one-click unsubscribe. Keep volume
  sane and only email people with a plausible reason to hear from you.
- **Secrets:** the Resend key lives only in Vercel env vars, never in the browser.
