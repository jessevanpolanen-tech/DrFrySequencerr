// ── Read the pipeline ───────────────────────────────────────────────
// GET /api/leads  → leads with their live enrollment status + click count.
// Lets the dashboard show REAL sequence state instead of localStorage.
// Read-only; CORS open for the static dashboard.
import { sql } from '../lib/db.js';

export const config = { runtime: 'nodejs' };

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const cors = { 'Access-Control-Allow-Origin': ALLOW_ORIGIN, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

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

    return new Response(JSON.stringify({ leads: rows }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
  } catch (err) {
    // Surface the real reason instead of an opaque 500 page.
    return new Response(JSON.stringify({ error: String(err && err.message || err) }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
  }
}
