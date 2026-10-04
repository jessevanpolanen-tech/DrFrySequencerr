// ── Prospect → lead (→ sequence) ────────────────────────────────────
// The only bridge from intelligence to sending, and it is human-triggered.
// Before a prospect becomes a lead, every reason not to email them is checked:
//   · it isn't ready (or it's `review` and the caller didn't accept the risk)
//   · the address ever unsubscribed, bounced or complained, on ANY brand
//   · the address is already a lead of another brand (leads.email is unique
//     across tenants; upserting would silently file it under the wrong brand)
//   · the address already has an active sequence
import { sql, upsertLead, findLeadByEmail, createEnrollment, logEvent } from '../db.js';
import { getSequence, dueAtForStep } from '../sequences.js';
import * as store from './store.js';

async function suppressed(email) {
  const rows = await sql`
    select type from events
    where email = ${email} and type in ('unsubscribed', 'bounced', 'complained')
    limit 1;`;
  return rows[0] ? rows[0].type : null;
}

async function hasActiveEnrollment(email) {
  const rows = await sql`select 1 from enrollments where email = ${email} and status = 'active' limit 1;`;
  return rows.length > 0;
}

export async function promoteProspects({ tenant, ids, enroll = false, sequenceId = '', allowRisky = false }) {
  const seqId = sequenceId || `${tenant}-signal`;
  const seq = enroll ? getSequence(seqId) : null;
  if (enroll && !seq) throw new Error(`unknown sequence "${seqId}"`);

  const prospects = await store.getProspects(tenant, ids);
  const results = [];

  for (const p of prospects) {
    const email = (p.contact && p.contact.email || '').toLowerCase();
    const skip = (reason) => results.push({ id: p.id, domain: p.domain, email, ok: false, reason });

    if (!(p.stage === 'ready' || (p.stage === 'review' && allowRisky))) { skip(`stage is ${p.stage}${p.stage === 'review' ? ' (pass allowRisky to accept)' : ''}`); continue; }
    if (!email) { skip('no contact email'); continue; }

    const sup = await suppressed(email);
    if (sup) { skip(`address previously ${sup}`); continue; }
    const existing = await findLeadByEmail(email);
    if (existing && existing.tenant !== tenant) { skip(`already a ${existing.tenant} lead`); continue; }
    if (await hasActiveEnrollment(email)) { skip('already in an active sequence'); continue; }

    const pz = p.personalization || {};
    const lead = await upsertLead({
      email,
      name: p.contact.name || '',
      org: p.company || p.domain,
      role: p.contact.title || 'Cold outreach',
      note: `Lead intel ${p.fit_score ?? '?'}/100${pz.trigger ? ` · ${pz.trigger}` : ''}`.slice(0, 500),
      tenant,
    });
    // What the `<tenant>-signal` sequence renders from. Only grounded fields.
    const intel = {
      prospect_id: p.id,
      domain: p.domain,
      fit_score: p.fit_score,
      trigger: pz.trigger || '',
      evidence_url: pz.evidence_url || '',
      angle: pz.angle || '',
      subject: pz.subject || '',
      opener: pz.opener || '',
    };
    await sql`update leads set intel = ${sql.json(intel)} where id = ${lead.id};`;
    await logEvent({ leadId: lead.id, email, type: 'captured', meta: { source: 'intel', tenant, prospectId: p.id, fitScore: p.fit_score } });

    let enrollmentId = null;
    if (seq) {
      const enrollment = await createEnrollment({ leadId: lead.id, email, sequenceId: seq.id, firstDueAt: dueAtForStep(new Date(), seq, 0) });
      enrollmentId = enrollment.id;
      await logEvent({ leadId: lead.id, enrollmentId, email, type: 'enrolled', meta: { sequenceId: seq.id, source: 'intel', tenant } });
    }

    await store.setStage(tenant, p.id, 'promoted', { leadId: lead.id });
    results.push({ id: p.id, domain: p.domain, email, ok: true, leadId: lead.id, enrollmentId });
  }

  const found = new Set(prospects.map((p) => p.id));
  for (const id of ids) if (!found.has(id)) results.push({ id, ok: false, reason: 'not found for this tenant' });
  return results;
}
