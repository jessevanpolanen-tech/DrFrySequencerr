// ── Resend inbound (reply) webhook ──────────────────────────────────
// This is what makes the sequence reply-aware AND keeps replies in your Outlook.
//
// Setup (see README): in Resend, configure Inbound so that mail to your
// Reply-To address (e.g. replies@contact.drfry.nl) is delivered to:
//   POST https://<your-backend>/api/webhooks/resend-inbound
//
// On a reply we:
//   1. STOP every active sequence for the sender (no more follow-ups), and
//   2. FORWARD the message to your real inbox (jesse@drfry.nl / Outlook),
//      with Reply-To set to the lead so you can answer straight from Outlook.
import { findLeadByEmail, stopEnrollmentsForEmail, logEvent } from '../../lib/db.js';
import { verifyResendSignature } from '../../lib/webhook.js';
import { sendEmail } from '../../lib/resend.js';

export const config = { runtime: 'edge' };

const OUTLOOK = process.env.FORWARD_TO || 'jesse@drfry.nl';

function extractEmail(s = '') {
  const m = String(s).match(/[^\s<>"]+@[^\s<>"]+/);
  return m ? m[0].toLowerCase() : '';
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const raw = await req.text();
  if (!(await verifyResendSignature(req, raw))) return json({ error: 'bad-signature' }, 401);

  let evt;
  try { evt = JSON.parse(raw); } catch { return json({ error: 'bad-json' }, 400); }

  const data = evt.data || evt;                 // tolerate {data:{…}} or flat
  const sender = extractEmail(data.from);
  const subject = data.subject || '(no subject)';
  const text = data.text || data.stripped_text || '';
  if (!sender) return json({ ok: true, skipped: 'no-sender' });

  // 1. Stop the sequence for this lead.
  await stopEnrollmentsForEmail(sender, 'replied');
  const lead = await findLeadByEmail(sender);
  await logEvent({ leadId: lead ? lead.id : null, email: sender, type: 'replied', meta: { subject } });

  // 2. Forward to Outlook so you actually see and can answer it.
  try {
    await sendEmail({
      to: OUTLOOK,
      subject: `↩ Reply from ${sender}: ${subject}`,
      text: `${lead ? (lead.name || sender) + (lead.org ? ' · ' + lead.org : '') : sender} replied to your outreach.\nTheir sequence has been stopped automatically.\n\n———\nFrom: ${data.from}\nSubject: ${subject}\n\n${text}`,
      // Answering this forward goes straight back to the lead:
      replyTo: sender,
      tags: [{ name: 'kind', value: 'reply-forward' }],
    });
  } catch (err) {
    await logEvent({ email: sender, type: 'forward_failed', meta: { error: String(err).slice(0, 200) } });
  }

  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
