import { sql } from '../lib/db.js';

export const config = {
  runtime: 'nodejs'
};

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const queryPromise = sql`
      with latest_enrollment as (
        select distinct on (lead_id)
          lead_id,
          sequence_id,
          step_index,
          status,
          next_due_at,
          enrolled_at
        from enrollments
        order by lead_id, enrolled_at desc
      ),
      event_stats as (
        select
          lead_id,
          count(*) filter (where type = 'clicked')::int as clicks,
          max(created_at) filter (where type = 'replied') as replied_at
        from events
        group by lead_id
      )
      select
        l.id,
        l.email,
        l.name,
        l.org,
        l.role,
        l.created_at,
        e.sequence_id,
        e.step_index,
        e.status,
        e.next_due_at,
        e.enrolled_at,
        coalesce(s.clicks, 0) as clicks,
        s.replied_at
      from leads l
      left join latest_enrollment e on e.lead_id = l.id
      left join event_stats s on s.lead_id = l.id
      order by l.created_at desc
      limit 500;
    `;

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Database query timed out after 7 seconds'));
      }, 7000);
    });

    const rows = await Promise.race([queryPromise, timeoutPromise]);

    return sendJson(res, 200, { leads: rows });
  } catch (error) {
    console.error('GET /api/leads failed:', error);

    return sendJson(res, 500, {
      error: error?.message || String(error)
    });
  }
}
