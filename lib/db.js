// Speaks the raw Postgres wire protocol over TCP — works with Supabase,
// Neon, Vercel Postgres, and any standard Postgres server.
//
// IMPORTANT — runtime:
//   postgres.js opens TCP sockets, so endpoints that import this file must run
//   on the Node.js runtime, NOT the Edge runtime. Each API route that touches
//   the DB sets `export const config = { runtime: 'nodejs' }`.
//
// IMPORTANT — connection string (Supabase):
//   Use the Transaction-mode pooler string from Supabase → Connect:
//     postgres://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres
//   Port 6543 = pgbouncer transaction pooling (the right choice for serverless).
//   Because pgbouncer transaction mode does not support prepared statements,
//   we disable them below with `prepare: false`.
import postgres from 'postgres';

let _sql = null;
function client() {
  if (_sql) return _sql;

  const connectionString =
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error(
      'No database URL set. Add POSTGRES_URL (Supabase Transaction-pooler string, port 6543) to the environment.'
    );
  }

  _sql = postgres(connectionString, {
    prepare: false,      // required for Supabase transaction-mode pooler (6543)
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: 'require',
  });
  return _sql;
}

export const sql = (strings, ...values) => client()(strings, ...values);
sql.json = (v) => client().json(v);

// ── Leads ──────────────────────────────────────────────────────────
// `tenant` keeps Dr. Fry and FahCel leads separate on the SHARED database.
// It is written on INSERT only — an existing lead never switches tenant.
// Default is 'drfry' for this deployment; override with the TENANT env var.
export const DEFAULT_TENANT = process.env.TENANT || 'drfry';

export async function upsertLead({ email, name = '', org = '', role = 'Cold outreach', phone = '', note = '', tenant = DEFAULT_TENANT }) {
  const e = email.trim().toLowerCase();
  const rows = await sql`
    insert into leads (email, name, org, role, phone, note, tenant)
    values (${e}, ${name}, ${org}, ${role}, ${phone}, ${note}, ${tenant})
    on conflict (email) do update set
      name = coalesce(nullif(excluded.name, ''), leads.name),
      org  = coalesce(nullif(excluded.org, ''),  leads.org)
    returning *, (xmax = 0) as _inserted;`;
  return rows[0];
}

export async function findLeadByEmail(email) {
  const rows = await sql`select * from leads where email = ${email.trim().toLowerCase()} limit 1;`;
  return rows[0] || null;
}

// ── Enrollments ────────────────────────────────────────────────────
export async function createEnrollment({ leadId, email, sequenceId, firstDueAt }) {
  const rows = await sql`
    insert into enrollments (lead_id, email, sequence_id, step_index, status, next_due_at)
    values (${leadId}, ${email.trim().toLowerCase()}, ${sequenceId}, 0, 'active', ${firstDueAt.toISOString()})
    returning *;`;
  return rows[0];
}

// Only this tenant's due steps. On the shared database, joining to the lead's
// tenant stops one brand's cron from sending the other brand's emails (and from
// racing the same rows). `enrollments` needs no tenant column — leads.email is
// unique, so the join resolves each enrollment to exactly one lead/tenant.
export async function dueEnrollments(limit = 50, tenant = DEFAULT_TENANT) {
  const rows = await sql`
    select en.*
    from enrollments en
    join leads l on l.email = en.email
    where en.status = 'active'
      and en.next_due_at <= now()
      and l.tenant = ${tenant}
    order by en.next_due_at asc
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
  const result = await sql`
    update enrollments set status = ${status}, updated_at = now()
    where email = ${e} and status = 'active';`;
  return result.count || 0;
}

// Delete every lead FOR ONE TENANT (enrollments/events cascade via FK).
// Always scoped — a Dr. Fry wipe must never touch FahCel's leads.
export async function deleteAllLeads(tenant = DEFAULT_TENANT) {
  const result = await sql`delete from leads where tenant = ${tenant};`;
  return result.count || 0;
}

// ── Events ─────────────────────────────────────────────────────────
export async function logEvent({ leadId = null, enrollmentId = null, email = '', type, meta = {}, resendId = null }) {
  await sql`
    insert into events (lead_id, enrollment_id, email, type, meta, resend_id)
    values (${leadId}, ${enrollmentId}, ${email.toLowerCase()}, ${type}, ${sql.json(meta)}, ${resendId});`;
}
