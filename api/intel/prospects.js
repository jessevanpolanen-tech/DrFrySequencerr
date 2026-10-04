// ── Read / triage prospects ─────────────────────────────────────────
// GET   /api/intel/prospects?tenant=…&stage=…&limit=…
//       → { counts: [{stage, n}], prospects: [...] }, best fit first
// PATCH /api/intel/prospects  { tenant, id, action: 'reject' | 'requeue' }
//       reject:  park it (never promoted, never reprocessed)
//       requeue: back to `discovered` with attempts reset, e.g. after adding
//                an enrichment key or fixing a failed crawl
// Requires INTEL_SECRET.
import { listProspects, stageCounts, setStage } from '../../lib/intel/store.js';
import { cors, guard, body, tenantOf, fail } from '../../lib/intel/http-guard.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  cors(res, 'GET, PATCH');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!guard(req, res)) return;

  try {
    if (req.method === 'GET') {
      const tenant = tenantOf(req);
      const stage = (req.query?.stage || '').toString();
      const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
      // Sequential: single pooled connection (see lib/db.js).
      const counts = await stageCounts(tenant);
      const prospects = await listProspects(tenant, { stage, limit });
      res.status(200).json({ tenant, counts, prospects });
      return;
    }

    if (req.method === 'PATCH') {
      const b = body(req);
      const tenant = tenantOf(req, b);
      if (!b.id) { res.status(400).json({ error: 'id required' }); return; }
      let row;
      if (b.action === 'reject') row = await setStage(tenant, b.id, 'rejected');
      else if (b.action === 'requeue') row = await setStage(tenant, b.id, 'discovered', { resetAttempts: true });
      else { res.status(400).json({ error: "action must be 'reject' or 'requeue'" }); return; }
      if (!row) { res.status(404).json({ error: 'not found for this tenant' }); return; }
      res.status(200).json({ ok: true, ...row });
      return;
    }

    res.status(405).json({ error: 'GET or PATCH' });
  } catch (err) {
    fail(res, err);
  }
}
