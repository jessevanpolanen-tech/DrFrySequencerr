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
| `api/send.js` | `POST /api/send` — send one email now (dashboard Compose → Send). |
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
Create a Postgres DB (Supabase, Neon, or Vercel Postgres). The DB layer uses the
`postgres` (postgres.js) driver over TCP, so it works with any standard Postgres.
Endpoints that touch the DB run on the **Node.js runtime** (not Edge).

**Supabase:** use the **Transaction-mode pooler** string from *Connect → Transaction*
— host contains `pooler.supabase.com`, **port 6543** (not the direct 5432 host).
Replace `[PASSWORD]` with your DB password. Transaction mode requires prepared
statements off; the driver is already configured with `prepare: false`.

Load the schema:
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
| `POSTGRES_URL` | Supabase **Transaction-pooler** string (`...pooler.supabase.com:6543/postgres`); auto-set by Vercel Postgres |
| `FROM_EMAIL` | `jesse@contact.drfry.nl` |
| `FROM_NAME` | `Dr. Fry` |
| `REPLY_TO` | `replies@contact.drfry.nl` *(see step 5 — must be an inbound address for reply-detection)* |
| `FORWARD_TO` | `jesse@drfry.nl` (your Outlook) |
| `CRON_SECRET` | any long random string |
| `RESEND_WEBHOOK_SECRET_EVENTS` | signing secret of the **events** webhook (`whsec_…`) |
| `RESEND_WEBHOOK_SECRET_INBOUND` | signing secret of the **inbound** webhook (`whsec_…`) |
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
through Resend Inbound, not straight to your mailbox.

1. **Pick a receiving subdomain** — use a *new* one, e.g. `reply.drfry.nl`
   (don't reuse `contact.drfry.nl`; keep sending vs receiving separate).
2. **Add the MX record.** Resend → **Emails → Receiving** (three-dots →
   *Receiving address* / custom domain) → add `reply.drfry.nl` → add the **MX
   record** it gives you at your DNS provider. Wait for it to verify.
3. **Add the inbound webhook.** Resend → **Webhooks → Add** →
   URL `https://your-app.vercel.app/api/webhooks/resend-inbound`, event type
   **`email.received`**. Copy its signing secret into `RESEND_WEBHOOK_SECRET`
   (same var — one secret works for both webhooks if they share it; otherwise
   create the events + inbound webhooks and use whichever secret you set).
4. **Point Reply-To at it:** set `REPLY_TO=reply.drfry.nl`'s address, e.g.
   `jesse@reply.drfry.nl`.

Flow: lead replies → mail hits `…@reply.drfry.nl` → Resend Inbound → our webhook
**stops their sequence** and **forwards the message to `jesse@drfry.nl`** with
Reply-To set to the lead, so you answer normally from Outlook.

> Note: the webhook payload carries the sender + subject (enough to auto-stop),
> but not the body — the handler fetches the body via Resend's received-emails
> API before forwarding. If that fetch ever fails, you still get the forward with
> a pointer to read the full message in Resend → Emails → Receiving.

If you skip this whole step, sending + sequences still work — set
`REPLY_TO=jesse@drfry.nl` and just watch replies by hand in Outlook (sequences
won't auto-stop).

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
