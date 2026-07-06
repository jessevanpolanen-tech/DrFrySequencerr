// ── Resend events webhook ───────────────────────────────────────────
// Point a Resend webhook at:  POST https://<your-backend>/api/webhooks/resend-events
// Subscribe to: email.delivered, email.opened, email.clicked,
//               email.bounced, email.complained.
//
// What it does:
//   • clicked  → logs the click (which link) — your warm signal
//   • opened   → logs the open
//   • bounced  → hard-stops every active sequence for that address
//   • complained (spam) → hard-stops + records the complaint
//
// Turn ON open & click tracking in Resend → Settings for opened/clicked to fire.
import { findLeadByEmail, stopEnrollmentsForEmail, logEvent } from '../../lib/db.js';
import { verifyResendSignature } from '../../lib/webhook.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const raw = await req.text();
  if (!(await verifyResendSignature(req, raw))) return json({ error: 'bad-signature' }, 401);

  let evt;
  try { evt = JSON.parse(raw); } catch { return json({ error: 'bad-json' }, 400); }

  const type = evt.type || '';
  const data = evt.data || {};
  const email = (Array.isArray(data.to) ? data.to[0] : data.to) || '';
  if (!email) return json({ ok: true, skipped: 'no-recipient' });

  const lead = await findLeadByEmail(email);
  const leadId = lead ? lead.id : null;

  switch (type) {
    case 'email.clicked':
      await logEvent({ leadId, email, type: 'clicked', meta: { link: data.click && data.click.link }, resendId: data.email_id });
      break;
    case 'email.opened':
      await logEvent({ leadId, email, type: 'opened', resendId: data.email_id });
      break;
    case 'email.bounced':
      await stopEnrollmentsForEmail(email, 'bounced');
      await logEvent({ leadId, email, type: 'bounced', meta: { reason: data.bounce || data.reason }, resendId: data.email_id });
      break;
    case 'email.complained':
      await stopEnrollmentsForEmail(email, 'complained');
      await logEvent({ leadId, email, type: 'complained', resendId: data.email_id });
      break;
    case 'email.delivered':
      await logEvent({ leadId, email, type: 'delivered', resendId: data.email_id });
      break;
    default:
      // ignore other event types
      break;
  }

  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
