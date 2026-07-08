// ── Read the pipeline ───────────────────────────────────────────────
// GET /api/leads  → leads with their live enrollment status + click count.
// Lets the dashboard show REAL sequence state instead of localStorage.
// Read-only; CORS open for the static dashboard.
//
// Node.js classic (req, res) handler — required on Vercel's Node runtime so
// the response completes (the Web/Fetch `Response` style can hang here).
import { sql } from '../lib/db.js';

export const config = { runtime: 'nodejs' };

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

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
    // Surface the real reason instead of an opaque 500 page.
    res.status(500).json({ error: String((err && err.message) || err) });
  }
}
