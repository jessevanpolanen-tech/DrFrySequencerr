// ── Public lead capture ─────────────────────────────────────────────
// POST /api/capture-lead  { email, name?, org?, role?, phone?, note?, enroll? }
//
// Called from the public website (preorder / contact forms). Upserts the
// lead and logs a `captured` event. Pass enroll:true to also start the
// founding-outreach sequence (default OFF — people who contacted YOU
// shouldn't get cold outreach).
//
// CORS is open (*) so the website — a different origin than this backend —
// can call it directly from the browser.
import { upsertLead, createEnrollment, logEvent } from '../lib/db.js';
import { SEQUENCES } from '../lib/sequences.js';

export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  try {
    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'valid email required' });

    const lead = await upsertLead({
      email,
      name: body.name || '',
      org: body.org || '',
      role: body.role || 'Website lead',
      phone: body.phone || '',
      note: body.note || '',
    });

    await logEvent({ leadId: lead.id, email, type: 'captured', meta: { source: body.source || 'website' } });

    let enrollment = null;
    if (body.enroll === true) {
      const seq = SEQUENCES['founding-outreach'];
      const firstDueAt = new Date(Date.now() + (seq.steps[0].day || 0) * 86400000);
      enrollment = await createEnrollment({ leadId: lead.id, email, sequenceId: seq.id, firstDueAt });
    }

    return json(200, { ok: true, lead, enrollment });
  } catch (err) {
    return json(500, { error: String(err && err.message || err) });
  }
}
