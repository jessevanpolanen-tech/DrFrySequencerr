// ── Read the pipeline ───────────────────────────────────────────────
// GET /api/leads  → leads with their live enrollment status + click count.
// DELETE /api/leads { confirm: 'DELETE_ALL_LEADS' } → wipes every lead.
// Node.js classic (req, res) handler.
import { sql, deleteAllLeads } from '../lib/db.js';

export const config = { runtime: 'nodejs' };

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method === 'DELETE') {
    try {
      const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
      if (body.confirm !== 'DELETE_ALL_LEADS') {
        res.status(400).json({ error: 'missing confirmation' });
        return;
      }
      const deleted = await deleteAllLeads();
      res.status(200).json({ ok: true, deleted });
    } catch (err) {
      res.status(500).json({ error: String((err && err.message) || err) });
    }
    return;
  }

  try {
    const rows = await sql`
      select
        l.id, l.email, l.name, l.org, l.role, l.created_at,
        e.sequence_id, e.step_index, e.status, e.next_due_at, e.enrolled_at,
        (select count(*) from events ev where ev.lead_id = l.id and ev.type = 'clicked') as clicks,
        (select max(ev.created_at) from events ev where ev.lead_id = l.id and ev.type = 'replied') as replied_at
      from leads l
      left join lateral (
        select * from enrollments en where en.lead_id = l.id order by en.enrolled_at desc limit 1
      ) e on true
      order by l.created_at desc
      limit 500;`;

    res.status(200).json({ leads: rows });
  } catch (err) {
    res.status(500).json({ error: String((err && err.message) || err) });
  }
}
