// ── Public lead capture ─────────────────────────────────────────────
// POST /api/capture-lead  { email, name?, org?, role?, phone?, note?, enroll? }
//
// Called from the public website (preorder / contact forms). Upserts the
// lead and logs a `captured` event. Pass enroll:true to also start the
// founding-outreach sequence (default OFF — people who contacted YOU
// shouldn't get cold outreach).
//
// Node.js classic (req, res) handler. CORS open (*) for the website origin.
import { upsertLead, createEnrollment, logEvent } from '../lib/db.js';
import { SEQUENCES } from '../lib/sequences.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');

    const email = (body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ error: 'valid email required' }); return; }

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

    import { notifyNewLead } from '../lib/resend.js';
// ...after the `if (body.enroll === true) {...}` block, before res.status(200):
if (lead._inserted) { try { await notifyNewLead(lead, body.source || 'website'); } catch (e) {} }

    res.status(200).json({ ok: true, lead, enrollment });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
}
