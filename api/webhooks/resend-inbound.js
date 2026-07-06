// ── Resend inbound (reply) webhook ──────────────────────────────────
// Makes sequences reply-aware AND keeps replies in your Outlook.
//
// Setup (see README): in Resend → Webhooks, add an endpoint pointing here with
// the event type `email.received`, and add the MX record for your receiving
// subdomain (e.g. reply.drfry.nl). Set REPLY_TO to an address on that subdomain.
//
// The webhook payload gives us the sender + subject (enough to STOP the
// sequence immediately). The body isn't in the payload — Resend requires a
// follow-up API call to fetch it — so we retrieve it, then forward the whole
// thing to your Outlook with Reply-To set to the lead.
//
// Inbound payload shape (Resend):
//   { type:'email.received', data:{ email_id, from, to:[…], subject, … } }
import { findLeadByEmail, stopEnrollmentsForEmail, logEvent } from '../../lib/db.js';
import { verifyResendSignature } from '../../lib/webhook.js';
import { sendEmail } from '../../lib/resend.js';

export const config = { runtime: 'edge' };

const OUTLOOK = process.env.FORWARD_TO || 'jesse@drfry.nl';

function extractEmail(s = '') {
  const m = String(s).match(/[^\s<>"]+@[^\s<>"]+/);
  return m ? m[0].toLowerCase() : '';
}

// The received-email content lives behind a separate API call. The REST path
// has varied across Resend versions, so try the known candidates and use the
// first that returns a body. Falls back to '' (we still forward metadata).
async function fetchReceivedBody(emailId) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !emailId) return '';
  const urls = [
    `https://api.resend.com/emails/receiving/${emailId}`,
    `https://api.resend.com/emails/${emailId}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) continue;
      const j = await res.json();
      const text = j.text || j.plain_text || (j.html ? j.html.replace(/<[^>]+>/g, ' ') : '');
      if (text) return text;
    } catch {}
  }
  return '';
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const raw = await req.text();
  if (!(await verifyResendSignature(req, raw))) return json({ error: 'bad-signature' }, 401);

  let evt;
  try { evt = JSON.parse(raw); } catch { return json({ error: 'bad-json' }, 400); }
  if (evt.type && evt.type !== 'email.received') return json({ ok: true, skipped: evt.type });

  const data = evt.data || evt;
  const sender = extractEmail(data.from);
  const subject = data.subject || '(no subject)';
  if (!sender) return json({ ok: true, skipped: 'no-sender' });

  // 1. Stop the sequence for this lead — works from the webhook alone.
  await stopEnrollmentsForEmail(sender, 'replied');
  const lead = await findLeadByEmail(sender);
  await logEvent({ leadId: lead ? lead.id : null, email: sender, type: 'replied', meta: { subject } });

  // 2. Fetch the body, then forward to Outlook so you see and can answer it.
  const body = await fetchReceivedBody(data.email_id);
  const who = lead ? (lead.name || sender) + (lead.org ? ' · ' + lead.org : '') : sender;
  try {
    await sendEmail({
      to: OUTLOOK,
      subject: `↩ Reply from ${sender}: ${subject}`,
      text:
        `${who} replied to your outreach — their sequence has been stopped automatically.\n\n` +
        `———\nFrom: ${data.from}\nSubject: ${subject}\n\n` +
        (body || '[Body not retrieved — open this message in the Resend dashboard → Emails → Receiving.]'),
      replyTo: sender, // answering the forward goes straight back to the lead
      tags: [{ name: 'kind', value: 'reply-forward' }],
    });
  } catch (err) {
    await logEvent({ email: sender, type: 'forward_failed', meta: { error: String(err).slice(0, 200) } });
  }

  return json({ ok: true, replied: sender });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
