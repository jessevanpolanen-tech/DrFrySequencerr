// Thin Postgres access layer over @vercel/postgres.
// Works with Vercel Postgres, Neon, Supabase — anything that speaks Postgres.
// Set POSTGRES_URL in your environment (Vercel wires this automatically for
// Vercel Postgres; for Neon/Supabase paste the pooled connection string).
import { sql } from '@vercel/postgres';

export { sql };

// ── Leads ──────────────────────────────────────────────────────────
export async function upsertLead({ email, name = '', org = '', role = 'Cold outreach', phone = '', note = '' }) {
  const e = email.trim().toLowerCase();
  const { rows } = await sql`
    insert into leads (email, name, org, role, phone, note)
    values (${e}, ${name}, ${org}, ${role}, ${phone}, ${note})
    on conflict (email) do update set
      name = coalesce(nullif(excluded.name, ''), leads.name),
      org  = coalesce(nullif(excluded.org, ''),  leads.org)
    returning *;`;
  return rows[0];
}

export async function findLeadByEmail(email) {
  const { rows } = await sql`select * from leads where email = ${email.trim().toLowerCase()} limit 1;`;
  return rows[0] || null;
}

// ── Enrollments ────────────────────────────────────────────────────
export async function createEnrollment({ leadId, email, sequenceId, firstDueAt }) {
  const { rows } = await sql`
    insert into enrollments (lead_id, email, sequence_id, step_index, status, next_due_at)
    values (${leadId}, ${email.trim().toLowerCase()}, ${sequenceId}, 0, 'active', ${firstDueAt.toISOString()})
    returning *;`;
  return rows[0];
}

export async function dueEnrollments(limit = 50) {
  const { rows } = await sql`
    select * from enrollments
    where status = 'active' and next_due_at <= now()
    order by next_due_at asc
    limit ${limit};`;
  return rows;
}

export async function advanceEnrollment(id, { stepIndex, nextDueAt, status }) {
  await sql`
    update enrollments set
      step_index = ${stepIndex},
      next_due_at = ${nextDueAt ? nextDueAt.toISOString() : null},
      status = ${status},
      updated_at = now()
    where id = ${id};`;
}

// Stop every active sequence for an email (reply / unsub / bounce).
export async function stopEnrollmentsForEmail(email, status) {
  const e = email.trim().toLowerCase();
  await sql`
    update enrollments set status = ${status}, updated_at = now()
    where email = ${e} and status = 'active';`;
}

// ── Events ─────────────────────────────────────────────────────────
export async function logEvent({ leadId = null, enrollmentId = null, email = '', type, meta = {}, resendId = null }) {
  await sql`
    insert into events (lead_id, enrollment_id, email, type, meta, resend_id)
    values (${leadId}, ${enrollmentId}, ${email.toLowerCase()}, ${type}, ${JSON.stringify(meta)}, ${resendId});`;
}
