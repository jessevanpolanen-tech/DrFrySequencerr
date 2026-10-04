// ── Promote prospects to leads ──────────────────────────────────────
// POST /api/intel/promote  { tenant, ids: [uuid], enroll?, sequenceId?, allowRisky? }
//
// Turns `ready` prospects (and `review` ones when allowRisky:true) into leads,
// carrying the grounded personalization onto leads.intel. With enroll:true
// they also start a sequence, `<tenant>-signal` unless sequenceId names another.
// Suppressed, cross-brand and already-sequenced addresses are skipped with a
// reason (lib/intel/promote.js). Never sends anything itself; the cron does.
// Requires INTEL_SECRET.
import { promoteProspects } from '../../lib/intel/promote.js';
import { cors, guard, body, tenantOf, fail } from '../../lib/intel/http-guard.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!guard(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  try {
    const b = body(req);
    const tenant = tenantOf(req, b);
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === 'string').slice(0, 100) : [];
    if (ids.length === 0) { res.status(400).json({ error: 'ids: [uuid] required' }); return; }
    const results = await promoteProspects({
      tenant,
      ids,
      enroll: b.enroll === true,
      sequenceId: b.sequenceId || '',
      allowRisky: b.allowRisky === true,
    });
    res.status(200).json({ ok: true, tenant, promoted: results.filter((r) => r.ok).length, results });
  } catch (err) {
    fail(res, err);
  }
}
