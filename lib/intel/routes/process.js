// ── Advance prospects through the pipeline ──────────────────────────
// POST /api/intel/process  { tenant, limit? }
//
// Leases up to `limit` (max 25) active prospects and walks each forward
// (crawl → enrich + signals → qualify → verify + personalize) within a ~45s
// budget. Safe to call repeatedly or alongside the cron: claims don't overlap.
// Requires INTEL_SECRET.
import { processBatch } from '../pipeline.js';
import { cors, guard, body, tenantOf, fail } from '../http-guard.js';


export default async function handler(req, res) {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!guard(req, res)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  try {
    const b = body(req);
    const tenant = tenantOf(req, b);
    const limit = Math.min(25, Math.max(1, Number(b.limit) || 10));
    res.status(200).json({ ok: true, ...(await processBatch({ tenant, limit, budgetMs: 45_000 })) });
  } catch (err) {
    fail(res, err);
  }
}
