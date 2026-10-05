// ── Prospect persistence ────────────────────────────────────────────
// Every query is scoped by tenant. Same single-connection rule as the rest of
// the app (lib/db.js runs max: 1 on the pgbouncer pooler): issue queries one
// at a time, never via Promise.all.
import { sql } from '../db.js';

export const ACTIVE_STAGES = ['discovered', 'crawled', 'enriched', 'qualified'];

// Email domains of this tenant's existing leads: companies already in the
// pipeline are not "discovered" again.
export async function knownLeadDomains(tenant) {
  const rows = await sql`select distinct split_part(email, '@', 2) as d from leads where tenant = ${tenant};`;
  return rows.map((r) => r.d).filter(Boolean);
}

// Insert new candidates; an existing (tenant, domain) is left untouched.
export async function insertProspects(tenant, candidates, sourceQuery) {
  const inserted = [];
  for (const c of candidates) {
    const rows = await sql`
      insert into prospects (tenant, domain, company, source_query, discovery)
      values (${tenant}, ${c.domain}, ${c.company || ''}, ${sourceQuery}, ${sql.json({ hits: c.hits || [], people: c.people || [] })})
      on conflict (tenant, domain) do nothing
      returning id, domain, company;`;
    if (rows[0]) inserted.push(rows[0]);
  }
  return inserted;
}

// Lease up to `limit` workable prospects. One statement, so `for update skip
// locked` makes two overlapping runs (cron + a manual call) take disjoint rows;
// the lease lets a crashed run's rows come back after two minutes.
export async function claimProspects(tenant, limit, maxAttempts) {
  return sql`
    update prospects set locked_until = now() + interval '2 minutes', attempts = attempts + 1
    where id in (
      select id from prospects
      where tenant = ${tenant}
        and stage = any(${ACTIVE_STAGES})
        and attempts < ${maxAttempts}
        and (locked_until is null or locked_until < now())
      order by updated_at asc
      limit ${limit}
      for update skip locked
    )
    returning *;`;
}

export async function saveProspect(p) {
  await sql`
    update prospects set
      domain = ${p.domain},
      company = ${p.company || ''},
      stage = ${p.stage},
      site = ${sql.json(p.site || {})},
      firmographics = ${sql.json(p.firmographics || {})},
      contacts = ${sql.json(p.contacts || [])},
      signals = ${sql.json(p.signals || [])},
      qualification = ${sql.json(p.qualification || {})},
      personalization = ${sql.json(p.personalization || {})},
      contact = ${sql.json(p.contact || {})},
      email_status = ${p.email_status || ''},
      fit_score = ${p.fit_score ?? null},
      confidence = ${p.confidence ?? null},
      attempts = ${p.attempts},
      error = ${p.error || ''},
      locked_until = ${p.locked_until ?? null},
      updated_at = now()
    where id = ${p.id} and tenant = ${p.tenant};`;
}

export async function domainTaken(tenant, domain, exceptId) {
  const rows = await sql`select 1 from prospects where tenant = ${tenant} and domain = ${domain} and id <> ${exceptId} limit 1;`;
  return rows.length > 0;
}

// The site text is the bulky part; the list view leaves it out.
export async function listProspects(tenant, { stage = '', limit = 100 } = {}) {
  return sql`
    select id, domain, company, stage, source_query, firmographics, contact, contacts, signals,
           qualification, personalization, email_status, fit_score, confidence, attempts, error,
           lead_id, created_at, updated_at,
           jsonb_build_object('title', site->>'title', 'description', site->>'description', 'finalUrl', site->>'finalUrl') as site
    from prospects
    where tenant = ${tenant} and (${stage} = '' or stage = ${stage})
    order by fit_score desc nulls last, updated_at desc
    limit ${limit};`;
}

export async function getProspects(tenant, ids) {
  return sql`select * from prospects where tenant = ${tenant} and id = any(${ids}::uuid[]);`;
}

export async function setStage(tenant, id, stage, { resetAttempts = false, leadId = null } = {}) {
  const rows = await sql`
    update prospects set
      stage = ${stage},
      attempts = case when ${resetAttempts} then 0 else attempts end,
      error = case when ${resetAttempts} then '' else error end,
      lead_id = coalesce(${leadId}::uuid, lead_id),
      locked_until = null,
      updated_at = now()
    where tenant = ${tenant} and id = ${id}
    returning id, stage;`;
  return rows[0] || null;
}

export async function stageCounts(tenant) {
  return sql`select stage, count(*)::int as n from prospects where tenant = ${tenant} group by stage order by stage;`;
}
