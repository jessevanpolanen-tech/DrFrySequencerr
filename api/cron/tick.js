// ── Scheduler ───────────────────────────────────────────────────────
// Invoked by Vercel Cron (see vercel.json) on a schedule, e.g. hourly.
// Finds every active enrollment whose next step is due, sends it via Resend,
// then advances the enrollment to the next step (or completes it).
//
// Protected by CRON_SECRET: Vercel Cron sends it as a Bearer token; a manual
// curl must include `?key=...` or the same Bearer.
import { dueEnrollments, advanceEnrollment, findLeadByEmail, logEvent } from '../../lib/db.js';
import { getSequence, dueAtForStep, renderStep } from '../../lib/sequences.js';
import { sendEmail } from '../../lib/resend.js';

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret set → allow (dev only; set one in prod)
  const auth = req.headers.get('authorization') || '';
  const url = new URL(req.url);
  return auth === `Bearer ${secret}` || url.searchParams.get('key') === secret;
}

export const config = { runtime: 'nodejs' };

export default async function handler(req) {
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);

  const backendBase = process.env.BACKEND_BASE_URL || new URL(req.url).origin;
  const due = await dueEnrollments(50);
  const results = [];

  for (const en of due) {
    const seq = getSequence(en.sequence_id);
    if (!seq) { await advanceEnrollment(en.id, { stepIndex: en.step_index, nextDueAt: null, status: 'paused' }); continue; }

    // Safety: if the step index ran off the end, complete it.
    if (en.step_index >= seq.steps.length) {
      await advanceEnrollment(en.id, { stepIndex: en.step_index, nextDueAt: null, status: 'completed' });
      continue;
    }

    const lead = await findLeadByEmail(en.email);
    if (!lead) { await advanceEnrollment(en.id, { stepIndex: en.step_index, nextDueAt: null, status: 'paused' }); continue; }

    const { stepId, subject, text } = renderStep(seq, en.step_index, lead, backendBase);

    try {
      const sent = await sendEmail({
        to: en.email,
        subject,
        text,
        tags: [
          { name: 'enrollment', value: en.id },
          { name: 'sequence', value: en.sequence_id },
          { name: 'step', value: stepId },
        ],
      });
      await logEvent({ leadId: lead.id, enrollmentId: en.id, email: en.email, type: 'sent', meta: { step: stepId }, resendId: sent.id });

      // Advance: compute the next step's due time, or complete.
      const nextIndex = en.step_index + 1;
      if (nextIndex >= seq.steps.length) {
        await advanceEnrollment(en.id, { stepIndex: nextIndex, nextDueAt: null, status: 'completed' });
      } else {
        const nextDue = dueAtForStep(en.enrolled_at, seq, nextIndex);
        await advanceEnrollment(en.id, { stepIndex: nextIndex, nextDueAt: nextDue, status: 'active' });
      }
      results.push({ email: en.email, step: stepId, ok: true });
    } catch (err) {
      // Leave it active and due — the next tick retries. Log the failure.
      await logEvent({ leadId: lead.id, enrollmentId: en.id, email: en.email, type: 'send_failed', meta: { step: stepId, error: String(err).slice(0, 300) } });
      results.push({ email: en.email, step: stepId, ok: false, error: String(err).slice(0, 200) });
    }
  }

  return json({ processed: results.length, results });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
