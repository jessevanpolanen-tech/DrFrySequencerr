// ── Enroll a lead into a sequence ───────────────────────────────────
// POST /api/enroll  { email, name?, org?, role?, phone?, note?, sequenceId? }
// Called by the dashboard's "Add cold outreach lead" button (and anything else).
// Upserts the lead, starts the sequence, and fires step 0 on the next cron tick.
//
// CORS is open so the static dashboard can call it. Lock ALLOW_ORIGIN to your
// dashboard's origin in production if you want.
import { upsertLead, createEnrollment, logEvent } from '../lib/db.js';
import { getSequence, dueAtForStep } from '../lib/sequences.js';

export const config = { runtime: 'nodejs' };

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let payload;
  try { payload = await req.json(); } catch { return json({ error: 'bad-json' }, 400); }

  const email = (payload.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid-email' }, 400);

  const sequenceId = payload.sequenceId || 'founding-outreach';
  const seq = getSequence(sequenceId);
  if (!seq) return json({ error: 'unknown-sequence' }, 400);

  const lead = await upsertLead({
    email,
    name: payload.name || '',
    org: payload.org || '',
    role: payload.role || 'Cold outreach',
    phone: payload.phone || '',
    note: payload.note || '',
  });

  const enrolledAt = new Date();
  const firstDueAt = dueAtForStep(enrolledAt, seq, 0); // step 0 offset (usually now)
  const enrollment = await createEnrollment({ leadId: lead.id, email, sequenceId, firstDueAt });
  await logEvent({ leadId: lead.id, enrollmentId: enrollment.id, email, type: 'enrolled', meta: { sequenceId } });

  return json({ ok: true, leadId: lead.id, enrollmentId: enrollment.id, sequenceId });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } });
}
