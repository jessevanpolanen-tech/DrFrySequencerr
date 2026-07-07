import { sql } from '../lib/db.js';

export const config = {
  runtime: 'nodejs',
  maxDuration: 15
};

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

const cors = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: cors
    });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          ...cors
        }
      }
    );
  }

  try {
    const query = sql`
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
      left join latest_enrollment e
        on e.lead_id = l.id
      left join event_stats s
        on s.lead_id = l.id
      order by l.created_at desc
      limit 500;
    `;

    const timeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Database query timed out after 8 seconds'));
      }, 8000);
    });

    const rows = await Promise.race([query, timeout]);

    return new Response(
      JSON.stringify({ leads: rows }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...cors
        }
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err?.message || String(err)
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...cors
        }
      }
    );
  }
}
