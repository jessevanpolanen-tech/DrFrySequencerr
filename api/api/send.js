// ── Send-one-email proxy ────────────────────────────────────────────
// Used by the dashboard's Compose → Send (Delivery mode: "Resend · proxy").
// POST /api/send  { to, subject, text, from?, replyTo? }
// Holds the Resend API key server-side so it never touches the browser.
//
// This is the endpoint the dashboard's "Proxy endpoint URL" field should point
// at:  https://<your-backend>/api/send
import { sendEmail, fromLine } from '../lib/resend.js';


const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let p;
  try { p = await req.json(); } catch { return json({ error: 'bad-json' }, 400); }

  const to = (p.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'invalid-to' }, 400);
  if (!p.subject) return json({ error: 'missing-subject' }, 400);

  try {
    // `from` from the dashboard is ignored in favour of the server's verified
    // FROM_EMAIL, so nobody can spoof the sender through this open endpoint.
    const result = await sendEmail({
      to,
      subject: p.subject,
      text: p.text || '',
      replyTo: p.replyTo,
      tags: [{ name: 'kind', value: 'manual-compose' }],
    });
    return json({ ok: true, id: result.id, from: fromLine() });
  } catch (err) {
    return json({ ok: false, error: String(err).slice(0, 300) }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
